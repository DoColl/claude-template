# CLAUDE.md

Guidance for Claude Code when working **on the kit itself**. (The `CLAUDE.md` a project receives is `modules/core/files/CLAUDE.md`.)

## What this repository is

`claude-template` is a modular Claude Code harness: instruction files, sub-agents, hooks, a local gate and CI workflows, installed into a project module by module by `bin/harness.mjs`. Read `README.md` for the idea and `docs/module-authoring.md` for the contract every module follows.

- `bin/harness.mjs` — the CLI (`list`, `init`, `add`, `status`, `update`). `lib/` — its logic: `kit.mjs` (manifests, dependency resolution), `render.mjs` (placeholders, slots, appended blocks), `install.mjs` (plan, apply, manifest).
- `modules/<id>/` — `module.json`, `files/` (copied as is), `fragments/` (inserted at slots of seed files), `append/`.
- `test/` — `engine.test.mjs` (pure functions and the static rules on every module), `install.test.mjs` (installs every module into a scratch project and runs its gate).
- `skills/harness-init/` — a skill to run the installer from a Claude Code session.

## Commands

```bash
node --test test/                     # everything; needs git and bash, no network
node bin/harness.mjs list             # the modules
node bin/harness.mjs init /tmp/try --modules <id>   # then, in /tmp/try: git init -q && git add -A && ./scripts/security-checks.sh --offline
pipx run --spec 'zizmor==1.31.1' zizmor --offline <rendered project>/.github/workflows/
```

## Rules

- **The contract is `docs/module-authoring.md`**; `test/engine.test.mjs` enforces most of it. A new rule for modules is a test there, not a sentence here.
- **Every module passes alone.** Installed with only what it requires, its guard is green and nothing it writes mentions a module that is not installed. Cross-module text goes through fragments and slots.
- **Seeds are the project's.** A file listed in `seed` is created once and never overwritten; fragments may only target seeds. Machinery stays kit-owned so `update` can refresh it.
- **No stack assumption in `core`, `agents`, `git-hooks`, `security-review`.** What only the project knows is a `TODO(harness)` comment or a config entry, never a guess. Stack-specific pieces are their own module (`node-audit`).
- **Pins are copied, never invented**: an action SHA, a tool version or a checksum comes from a reviewed source. Workflows follow the rules in `docs/module-authoring.md` § Workflows and zizmor reports nothing on them.
- **Strangers read this.** No names of people, organisations or infrastructure from the project a piece came from, no issue numbers or incident dates; state reasons in general terms. English only.
- **Say what was exercised.** A module's convention page states whether the piece has run in production, is unit-tested only, or has never run live. Do not upgrade that statement without having run it.
- **Security-sensitive pieces** — the Bash allowlist (`modules/agents/files/.claude/hooks/`), `auto-merge`, `claude-ci`: when a generalisation would loosen a condition, keep the stricter form. Every allowlist change comes with rows in its test table (the allow, and the nearby form that must stay blocked).
- The installer has no dependency beyond Node (>= 20). Keep it that way.

## Before pushing

`node --test test/`, then zizmor on a rendered project and on `.github/workflows/`. A change to a guard or a workflow is also tried by hand in a scratch project: break the thing the guard protects and watch it go red.
