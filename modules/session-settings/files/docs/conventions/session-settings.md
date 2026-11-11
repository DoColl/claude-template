# Session settings

**Rule (CLAUDE.md § Key conventions):** `.claude/settings.json` denies reading secret files and turns the Bash sandbox on; it never sets `bypassPermissions`, never allows all of Bash, never approves every project MCP server and never disables hooks. Personal rules go in `.claude/settings.local.json`, which stays untracked.

## Status

Written for the kit from Claude Code's documentation of permission rules and of the sandbox. **Never run live by the kit's authors**: the guard checks what the file says, not how the runtime reads it. Do the live check below once, and again after a Claude Code upgrade.

## Why

`CLAUDE.md` asks; a settings file decides. An instruction such as "never read `.env`" is followed until a session is steered by something it read, or simply reaches for the file while debugging. A deny rule is evaluated by Claude Code itself, before the model's choice matters, and no allow rule can take it back.

The same file is also the widest grant in the repository. It is loaded by every session, before any instruction, and one line in it — a bypass mode, an allow rule for all of Bash — removes every prompt for everyone who opens the project. So the file is a seed the project owns, and a guard pins what it must keep and what it must never say.

## Details

### What the seed denies

```json
"deny": ["Read(.env)", "Read(.env.*)", "Read(!.env.example)", "Read(!.env.sample)", "Read(!.env.template)", "Read(secrets/**)"]
```

- A bare file name follows gitignore rules: `Read(.env)` matches a `.env` at any depth under the project.
- `Read(!…)` carves one file out of the rules before it, in the same list. The three carve-outs are the usual names of a committed example file, which must hold no secret. Delete the ones the project does not use.
- Deny wins over allow and over ask, from any settings file. A carve-out only reaches the rules of its own file.

Add a rule for each place the project keeps secrets: key files, a credentials directory, a local database, a cloud CLI's config. The kit ships only the names that mean the same thing in every stack.

**What a deny rule covers, by the documentation:** Claude's file tools (Read, Grep, Glob, `@file` mentions), the file commands Claude Code recognises in Bash (`cat`, `head`, `tail`, `sed`, `tee`) and redirections. It does **not** cover a command that reads files without naming them (`grep -r pattern .`), nor a script that opens files itself. That gap is what the sandbox is for.

### Sandbox

```json
"sandbox": { "enabled": true, "autoAllowBashIfSandboxed": false }
```

- `enabled` confines shell commands at the operating-system level: writes stay in the working directory, and the paths of the `Read` deny rules are merged into what the sandbox hides. It covers shell commands only: file tools, MCP servers and hooks run outside it and follow the permission rules.
- `autoAllowBashIfSandboxed` defaults to `true`, which runs a sandboxed command **without asking**. The seed sets it to `false`: turning the sandbox on must not drop a prompt. A project that wants the trade — fewer prompts, inside the sandbox — sets it back, and the guard notes it.
- **It needs the platform.** macOS: built in. Linux and WSL2: `bubblewrap` and `socat` must be installed. Native Windows and WSL1: no sandbox. Where it cannot start, Claude Code **runs commands unsandboxed** and only says so at startup. To refuse to start instead, add `"failIfUnavailable": true` — once every contributor's machine can run it.
- A command that cannot work inside the sandbox (a container runtime, for instance) goes in `sandbox.excludedCommands`, by name, rather than by turning the sandbox off.

### What the file must never grant

| Setting | Why not |
|---|---|
| `permissions.defaultMode: "bypassPermissions"` | every session skips every prompt |
| `permissions.allow` with `Bash`, `Bash(*)`, `PowerShell` | every shell command, pre-approved — allow exact commands instead |
| `enableAllProjectMcpServers: true` | a pull request that adds a server to `.mcp.json` gets it started for everyone, unasked |
| `disableAllHooks: true` | a hook is how a rule is enforced rather than asked for; this turns them all off |

### Personal settings

`.claude/settings.local.json` is one person's file: their own allow rules, their own paths. It stays out of git (the kit's `.gitignore` block ignores everything under `.claude/` but the shared files). Tracked, it would apply to everyone.

### Limits

- Only the root `.claude/settings.json` is checked. A settings file in a subdirectory, user settings and managed settings are outside the guard.
- A deny rule can be removed by whoever can edit the file, and the guard by whoever can edit the guard: both are instruction files, reviewed as a change of privilege.
- Settings from a higher scope (managed, command line) can still widen or narrow what this file says.
- The sandbox is Claude Code's; what it holds against is in its own documentation, and the kit has not tested it.

### Live check

In a fresh session, in a project with a `.env` file that holds a dummy value:

1. Ask the session to read `.env` with the Read tool, then with `cat .env`. Both must be refused, and the refusal must name a permission rule.
2. Ask it to read `.env.example`. It must succeed.
3. Run `/sandbox`: it must report the sandbox as enabled, with no missing dependency.
4. Ask it to write a file outside the project directory from Bash (`touch ~/harness-sandbox-probe`). It must fail, or ask.

If one of these does not hold, the file is not doing what this page says on your version: find out why before relying on it.

## Checks

`scripts/guards.d/15-session-settings.sh`:

- **SS-1** — the file is valid JSON and still denies `Read(.env)` and `Read(.env.*)`; a carve-out names one file, never `.env` itself, never a wildcard.
- **SS-2** — none of the four grants above. A sandbox that is off, or that runs sandboxed commands without a prompt, is reported as a note.
- **SS-3** — no `.claude/settings.local.json` is tracked, at any depth.

The guard needs Node to read JSON: without it, it skips locally and fails on a runner.

## History

- Installed with the kit.
