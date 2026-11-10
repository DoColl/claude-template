---
name: harness-init
description: Install or extend the claude-template harness in the current project — choose the modules (instruction files, sub-agents and their Bash allowlist, git hooks, security workflow, a CI skeleton, auto-merge, weekly digest, Claude in CI, OpenSpec), run the installer, then fill in what only the project knows. Use when the user asks to initialise, set up or add a module of the Claude Code harness in a repository.
---

# Initialise a project with claude-template

The kit is a checkout of the `claude-template` repository on this machine. Its installer is `bin/harness.mjs` (Node >= 20, no dependency). You run the installer; you do not copy files by hand.

## 1. Locate the kit

Use `$CLAUDE_TEMPLATE_DIR` if it is set, otherwise ask the user where the checkout is. Check that `<kit>/bin/harness.mjs` exists before going on.

## 2. See what is there

```bash
node <kit>/bin/harness.mjs list --json
node <kit>/bin/harness.mjs status .        # only if .claude/harness.json exists: the project is already initialised
```

## 3. Choose the modules with the user

Present the modules grouped by phase (`day-1`, `first-ci`, `pr-flow`, `on-demand`), each with its one-line summary. `core` is always installed; what a module requires is added automatically. Recommend the day-1 set (the modules flagged `recommended`) for a new project, and the later phases only when the project has what they need — a CI workflow before `auto-merge`, a private repository before `claude-ci`. The choice is the user's: ask, do not decide for them.

For a new repository on GitHub that will work through pull requests, offer the whole set in one run rather than a second installation later — each installation is its own pull request to read and merge by hand:

```bash
node <kit>/bin/harness.mjs init . --modules git-hooks,agents,security-review,ci-security,ci-workflow,auto-merge
```

`ci-workflow` installs the CI workflow `auto-merge` waits for, under the same name, so nothing has to be written by hand. Leave it out when the project already has a CI workflow. Say what `auto-merge` means before the user accepts it: a green pull request is merged with nobody watching.

Ask for a placeholder value only when the default is wrong for this project (`PROJECT_NAME` defaults to the directory name, `DEFAULT_BRANCH` to `main`, `CI_WORKFLOW` to `CI`).

## 4. Install

In a project that already has files, show the plan first:

```bash
node <kit>/bin/harness.mjs init . --modules <ids> [--set KEY=VALUE]... --dry-run
```

Then run it without `--dry-run`. On an initialised project, use `add . --modules <ids>`.

- **Conflicts** (exit code 2): a file exists with other content and was left untouched. Show the user each one and let them decide; `--force` overwrites kit files, never the project's own seeds such as `CLAUDE.md`.
- **Fragments not inserted**: the project's `CLAUDE.md` has no slot for them (it was written before the kit). Show the fragment files the installer names and propose where to paste them.

## 5. Fill in what only the project knows

The installer prints "Next steps" and counts the `TODO(harness)` markers; `status .` lists them per file. Work through them with the user:

- `CLAUDE.md` — project overview, architecture map, commands, the sensitive areas under "Before pushing", the conventions for new code. Read the codebase and propose text; do not invent a convention the code does not show. Keep each rule to a short bullet and put detail in `docs/conventions/`.
- `.claude/hooks/agent-bash-guard.config.json` (agents module) — the exact verification commands: tests, build, type-check. Nothing that writes, installs or reaches the network.
- `.claude/skills/project-security-review/SKILL.md` (security-review module) — the same sensitive areas, and the invariants.

**Stay inside the gaps.** This session fills `TODO(harness)` markers. It does not write an ADR, a convention page, a runbook, a guard or a finding unless the user asks for one: those record decisions and incidents the project has not had yet, and each one written now is a file someone must review.

**A gap may stay open.** A `TODO(harness)` left in place is a correct state — the advisory guard counts them and never fails. In a project with no code yet, fill the project overview, the out-of-scope list and whatever the user can already state, and leave these as they are:

- "Commands" in `CLAUDE.md`, and the verification commands of `.claude/hooks/agent-bash-guard.config.json` — there is nothing to build or test;
- "Environment variables", "Architecture" beyond what is decided, and "Conventions for new code" — no code shows them yet;
- "Version history" — nothing has shipped;
- the invariants of the review skill, the first row of `SECURITY_REVIEW.md`, `scripts/guards.d/50-project.sh` — no finding yet;
- the jobs of `.github/workflows/ci.yml` and the ecosystems of `.github/dependabot.yml` — no stack yet.

Tell the user which gaps you left and why, in one list. Do not fill a gap with a guess to make the count go down.

## 6. Verify once, review once

The installer's output is already tested in the kit; what is new is what this session wrote. One light pass, then one review:

1. **Verify, once.** `git add -A` (staging is not committing), then `./scripts/security-checks.sh --offline`: it must pass. Several guards read what git tracks; run before the first `git add`, they report notes instead of checking. Re-read your own edits to the seeds once. No sub-agent for this, and no second pass after a clean first one.
2. **Say what was not edited.** `node <kit>/bin/harness.mjs update . --dry-run` must print `nothing to write`, with no `left alone`, `would be updated` or `CONFLICTS` list: every kit file is then what the kit ships. Note the kit's commit (`git -C <kit> rev-parse HEAD`). Both go in the pull request description.
3. **Review, once, at the end.** Follow "Before pushing" of the installed `CLAUDE.md` for the files this session wrote — the seeds as filled and the project's own files — not for the kit files, which were reviewed in the kit (`docs/conventions/security-review.md` § Scope, when that module is installed). Filled seeds are tier 1 when they are prose and tier 2 when they change what runs or what a session may do (the verification commands, a workflow job). Run that tier's passes one time, when everything is filled; give a reviewing agent the kit commit and the result of step 2 in its brief. Do not run the chain after each file, and do not re-run it after fixing a finding: re-run the gate.

## 7. Hand over

- Do not commit unless the user asks. Instruction files (`CLAUDE.md`, `.claude/**`, `.githooks/**`) deserve a human read before they are committed: every session executes them.
- Tell the user to opt in to the git hooks (`git config core.hooksPath .githooks`) if that module was installed, and to restart open Claude Code sessions so new agents and skills are picked up.
- Repeat the module-specific warnings the installer printed (a workflow that has never run live, a module meant for private repositories).
- List the gaps left open on purpose.
