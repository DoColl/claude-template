---
name: harness-init
description: Install or extend the claude-template harness in the current project — choose the modules (instruction files, sub-agents and their Bash allowlist, git hooks, security workflow, auto-merge, weekly digest, Claude in CI, OpenSpec), run the installer, then fill in what only the project knows. Use when the user asks to initialise, set up or add a module of the Claude Code harness in a repository.
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

Then run the gate: `./scripts/security-checks.sh --offline` must pass.

## 6. Hand over

- Do not commit unless the user asks. Instruction files (`CLAUDE.md`, `.claude/**`, `.githooks/**`) deserve a human read before they are committed: every session executes them.
- Tell the user to opt in to the git hooks (`git config core.hooksPath .githooks`) if that module was installed, and to restart open Claude Code sessions so new agents and skills are picked up.
- Repeat the module-specific warnings the installer printed (a workflow that has never run live, a module meant for private repositories).
