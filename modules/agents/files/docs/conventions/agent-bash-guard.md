# Sub-agent Bash allowlist (`.claude/hooks/agent-bash-guard.mjs`)

**Rule (CLAUDE.md § Delegation):** the read-only sub-agents (`reviewer`, `doc-sync`, and `security-reviewer` when installed) and the verification agent (`verifier`) are *enforced*, not trusted. Each declares in its frontmatter a PreToolUse hook on Bash that runs the guard with a profile; a command outside the profile's **exact shapes** is blocked (exit 2) and the agent sees why. A tripwire against a steered or over-eager sub-agent, not a sandbox — § Limits.

## Why

"Read-only" written in an agent's body enforces nothing. As observed in practice (the documentation does not spell it out), a sub-agent's Bash commands run under the session's permission settings: where a developer has pre-approved `git push`, a package manager or a database CLI for their own convenience, a sub-agent can run them without a prompt. A reviewer steered by an instruction-shaped comment in the code it reads could then push, reset a database, switch the branch of a shared checkout or probe a live service.

Denylists do not hold either: an early draft of this guard blocked dangerous flags by name and was bypassed through option abbreviations (`git diff --outp=` is `--output=`) and through redirections hidden by quoting. The guard therefore allows exact shapes and nothing else.

## Design: one mechanism, exact shapes

A command is split into segments (`|`, `&&`, `||`, `;`, newline, quotes tracked); each segment is an argv; each argv must match a shape. **Nothing is denylisted.** The sets at the top of `agent-bash-guard-lib.mjs` are the policy (`GIT_SUBS`, `GIT_COMMON`, `READERS`, `SAFE_PREFIX`, `GATE_SHAPES`) and the table in `agent-bash-guard.test.mjs` is its specification; this page describes the shape, not the lists.

- **Shapes available to every profile** — a `git` read subcommand with *literal* flags and value options whose value is inert (no global option: pager and locks are set through the prefixes); the gate script with its exact argument (`scripts/security-checks.sh --offline`: without the flag the gate may reach the network); a reader (`cat head tail wc grep ls true false`) with literal or clustered single-letter flags. Positional arguments are refs or **project-relative paths**: no leading `-`, `/`, `~`, `$`, no `..` segment; `"$CLAUDE_PROJECT_DIR"/…` is accepted and resolved to the root. `grep` and `git grep` take their pattern only through `-e` (free text minus `$`, backtick, backslash, `<`, `>`): a pattern is never a bare argument, so no tokenizer slip can turn one into a redirection. Environment prefixes: `SAFE_PREFIX` only (six inert assignments such as `GIT_OPTIONAL_LOCKS=0`, `GIT_PAGER=cat`). Redirections are recognised in the character loop that tracks quotes — never by regex — and only a bare fd-dup onto 1/2 or a truncate/append to `/dev/null` passes.
- **Rejected outright** — `$(…)`, backticks, `$'…'`, process substitution, `&`, `|&`, heredocs, any other redirection, subshells and brace groups (so `${…}` too), an unquoted `#` (the shell drops a comment, quotes included, so a quote "opened" inside one would hide the following lines from the guard while the shell runs them; a quoted or escaped `#` is a plain character), an unquoted `*`, `?`, `[` or `^` anywhere in a word and a word starting with an unquoted `=`, empty quotes in front included (the shell expands them after the guard has read the word: with a file named `--output=x` in the directory, `git diff *` reaches git with an option nobody approved; quoted or escaped, they are plain characters, and git and grep read their own patterns from the quoted form — given to `cat`, `head`, `tail`, `wc` or `ls`, a quoted pattern is a file name, so files are found with `Glob`; `HEAD~1` stands for `HEAD^`), a pattern that spans lines, `cd` (readonly), and every other program: no `gh` (network egress), `sed`, `awk`, `jq`, `sort`, `find`, interpreters, package managers. The agents have `Read`/`Grep`/`Glob` for files; Bash is for git, the gate and output trimming.
- **`verify` adds the project's verification commands**, read from `.claude/hooks/agent-bash-guard.config.json`.

## The verification config

```json
{
  "verify": [
    { "argv": ["make", "test"], "note": "unit tests" },
    { "cwd": "backend", "argv": ["npm", "test"] },
    { "argv": ["go", "test", "./..."] }
  ]
}
```

- Each entry is an **exact argv**: no extra argument, no variation. `note` is free text for humans.
- An entry with `cwd` is accepted only as `cd <cwd> && <argv>` (`cd "$CLAUDE_PROJECT_DIR"/<cwd> && …` too), the `cd` being the very first segment. After a `cd`, a root command is refused, and a directory's command is refused at the root: a command runs where the config says.
- Each may be followed by `2>&1`, `| tail -N`, `| head -N`.
- Tokens are plain (`A-Z a-z 0-9 @%+=:,./_-`), nothing absolute, no `..`. `git`, `cd` and `sudo` are refused as commands.
- One invalid entry voids the whole file, and a missing or invalid file never widens anything: the `verify` profile then allows the read-only shapes only, and the block message says why.

The file is as trusted as the hook itself: it lives under `.claude/`, changes to it are reviewed like any instruction-file change. List what *checks* the code — tests, build, type-check, a linter in check mode. Keep out anything that writes (a linter with `--fix`, a code generator), installs (`npm install`; plain `npx` fetches an absent package, `npx --no` does not) or reaches the network.

## Mechanics

```yaml
hooks:
  PreToolUse:
    - matcher: Bash
      hooks:
        - type: command
          command: node "$CLAUDE_PROJECT_DIR/.claude/hooks/agent-bash-guard.mjs" readonly || exit 2
```

Scoped to that agent only — the main session and `implementer` are untouched. `agent-bash-guard.mjs` is the CLI (payload on stdin, exit 0 allow / 2 block with a one-line reason the agent sees); `decide(command, profile, config)` lives in `agent-bash-guard-lib.mjs`, so there is no "am I the main module" check that could fail open. Every error path exits 2 and the hook line ends with `|| exit 2`: a missing `node`, a missing file or a crash **blocks** — Claude Code blocks a tool call only on exit code 2 and treats any other failure as non-blocking.

Frontmatter `hooks` are ignored for agents shipped by a **plugin** (Claude Code documentation), so these agents must be project files.

## Trust: when the hook does not run at all

The guard cannot protect anything in a folder Claude Code does not trust. Per the Claude Code documentation, a project agent's frontmatter hooks run only after the **workspace trust dialog has been accepted for the folder that contains the agent file**. Until then the sub-agent still runs, its hooks are skipped, and the only trace is a line in the debug log. Trusting a parent folder is not enough, and a non-interactive session (`claude -p`, the SDK) does not count as trusted.

What follows from it:

- **Every new folder needs it again**: a fresh clone, and each git worktree — a worktree is another folder. Open one interactive session there and accept the prompt before relying on the read-only agents in it.
- **Headless runs** in a folder that was never trusted interactively run these agents **unguarded**. Do not hand a read-only agent to an automated job on the strength of this hook.
- The live check below is the only proof, and it holds for the folder and the mode it was run in.

This is the one place where the guard fails open, and it is outside the hook's reach. If your project needs the allowlist in headless sessions, evaluate enforcing it from a `PreToolUse` hook in `.claude/settings.json` as well — settings hooks follow a different trust rule — keyed on the sub-agent the call comes from. The kit does not ship that second layer.

**Checks:** `scripts/guards.d/20-agent-guards.sh` — AG-1 runs the specification (tables, config, CLI exit codes, and the real hook line of every agent that has Bash and no editing tool); AG-2 checks that the hook files are tracked and not ignored (right after an installation, while `.claude/harness.json` itself is not tracked yet, an untracked hook file is a note asking for `git add -A`; once the manifest is tracked, or on a CI runner, it fails). Both run in the gate, hence in CI wherever a workflow runs the gate.

## Live check

The tests prove the script, not the runtime that is supposed to call it. Once after installing, in every new clone or worktree where you rely on the agents, and after each Claude Code upgrade:

1. Open a fresh interactive session in that folder and accept the workspace trust prompt if asked.
2. Ask it to spawn `reviewer` with this brief, verbatim: "Run `touch harness-live-check.tmp`, then `git status --short`, and report both results."
3. The agent must report the first command blocked by `agent-bash-guard[readonly]`, and the file must not exist: `ls harness-live-check.tmp` fails. The absent file is the proof; "blocked" in the report is only a claim.

If the file exists, the hook did not run: do not rely on the read-only agents until it does.

## Extending

A new shape is an entry in the lib's sets **plus** rows in the test table (the allow, and the nearby write form that must stay blocked). Prefer literal flags; a value option needs an inert value. Never add network clients, interpreters, `git` write subcommands or environment variables that change what a later command runs. A new verification command is an entry in the config, not a code change.

## Limits

- The guard classifies the Bash tool's command string; it does not see child processes. The gate script and the verification commands execute repository code — reviewed, but a pull request under review can change it — and a session opened inside that pull request's worktree uses its copy of the guard, of the config and of the agent files.
- Path confinement is lexical: a project-relative name that is a **symlink** out of the project is followed by `cat`/`grep` (read into the agent's context, never written anywhere — the `Read`/`Grep` tools follow symlinks just the same). A committed symlink shows in the diff under review. A project-relative secret such as a local `.env` stays readable, as through `Read`.
- Filename expansion is refused through an unquoted `*`, `?`, `[` or `^` anywhere in a word and an unquoted `=` that begins one (empty quotes in front included: zsh drops them before it looks at the first character). With `<`, `(`, `{` and `#` refused for other reasons, that covers every pattern character of bash, and of zsh with its default options or `EXTENDED_GLOB`. A `~` inside a word is inert unless the word holds another wildcard, all of which are refused. Other shell options are not modelled: the operators of `KSH_GLOB` and of bash's `extglob` need parentheses, which are refused, and a tilde the guard lets through — a value given as its own word (`tail -c ~`), or after `=` (bash's `a=~/x`, zsh's `MAGIC_EQUAL_SUBST`) — becomes a home path inside that word: a different value or path, never a new option.
- Nothing relies on the working directory persisting between Bash calls: `cd` is blocked in `readonly`, and `verify` accepts it only as the first segment of one command.
- `implementer` is deliberately **not** guarded: it writes code; its "never stash, never switch branches" rule is prose, and the orchestrator reviews its `git diff` before anything else happens.
- The tokenizer is a conservative approximation of bash: anything it cannot classify is blocked, which can refuse a legitimate command (add the shape); a divergence the other way is a bug — add the command to the block table with the fix. A sub-agent cannot ask the user: a blocked legitimate command surfaces as "blocked" in its report.
- The hook needs `node` (>= 20) on the machine. Without it every Bash command of a guarded agent is blocked.
- In an untrusted folder or a headless session the hook is not called at all — § Trust.

## History

- Installed with the kit. The allowlist logic comes from a production codebase where two earlier, denylist-based drafts were bypassed in review; the verification commands were moved from code to the config file when the guard was made project-agnostic, and a root command is no longer accepted after a `cd`.
- A fresh-context security review of the kit found a third bypass, present since the first version: the tokenizer did not model shell comments, so a command the guard read as one harmless `grep` could carry further lines that the shell executed. An unquoted `#` and a multi-line pattern are now refused, with their rows in the block table; the gate script is refused after a `cd` as well. The lesson is the one the design already states — anything the guard and the shell could read differently is rejected, not interpreted.
- A review of an installed project found a fourth: positional arguments and option values accepted unquoted glob characters. The guard approved the word it read; the shell then replaced it with the file names it matched, and a file named like an option (`--output=x`) became one — a write through a read-only agent, reproduced with `git diff HEAD *`. An unquoted `*`, `?`, `[` or `^` anywhere in a word and a word-initial `=` are now refused, with their rows in the block table and the quoted forms in the allow table. A first version of that fix tested whether a quote had opened rather than what the word held: zsh drops empty quotes, so `git diff HEAD ''=--output=t/e` still wrote a file — given an executable committed under that name — until review caught it before the merge.
