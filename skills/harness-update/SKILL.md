---
name: harness-update
description: Bring a project installed with the claude-template kit up to the kit's current version — everything, or chosen modules or files — read what changed, merge the kit files the project edited, and leave the real conflicts to the user. Use when the user asks to update, refresh or upgrade the harness, to check whether a project is behind the kit, or to change a setting of an installed module.
---

# Update a project installed with claude-template

The kit is a checkout of the `claude-template` repository on this machine (`$CLAUDE_TEMPLATE_DIR`, or ask), with its git history: `update --merge` looks for the installed version of a file there. Bring it to the version the user wants first (`git -C <kit> pull`, or a tag), from a clean tree. The project must have `.claude/harness.json`.

## 1. See where the project stands

```bash
node <kit>/bin/harness.mjs status .
node <kit>/bin/harness.mjs update . --check        # writes nothing; exit 3 when behind
```

`update` ends its report, `--check` included, with the "BY HAND" steps of the versions it crosses, taken from `<kit>/CHANGELOG.md`: what no update does. Read the entries themselves for the rest of what changed. When the kit is a checkout ahead of its last release, the report adds an "UNRELEASED" part: the changelog fragments waiting in `<kit>/changes/`, with their "By hand" steps, which no changelog entry carries yet. The manifest then records the last release's version beside the commit the files came from; say so to the user, and prefer a release tag for a project that is not the kit's own test.

## 2. Choose the scope with the user

Everything, or a selection — show the list `--check` printed and ask:

```bash
node <kit>/bin/harness.mjs update . --modules <ids> --dry-run
node <kit>/bin/harness.mjs update . --only <file or directory> --dry-run
```

Prefer whole modules: a guard refreshed without the library it sources, or a workflow without its guard, is a module in two versions. What a selection leaves out stays listed as behind.

## 3. Apply

```bash
node <kit>/bin/harness.mjs update . [--modules <ids>] --merge
```

- **updated / created / removed**: kit files the project had not edited. Nothing to decide.
- **merged**: the project's edits and the kit's changes did not overlap. Read each merged file before going on (`git diff <file>`): a clean merge is not a correct one, least of all in a workflow or a hook.
- **CONFLICTS**: the two overlap, or the installed version was not found. Show the user both sides (`node <kit>/bin/harness.mjs show . <file> | diff - <file>`) and let them decide. If the project's edit is a value the kit now takes as a setting, pass it with `--set KEY=VALUE` and take the kit's file with `--only <file> --force`. Never `--force` to make a conflict go away, and never resolve one in a security-sensitive file (the Bash allowlist, a merge gate, a Claude workflow) by picking the looser side.
- **Seeds** (`CLAUDE.md`, configs) never follow the kit. If the changelog says a skeleton changed, show the user the new part and ask whether to report it by hand.

A setting of an installed module is changed the same way, without any new kit version: `node <kit>/bin/harness.mjs update . --set KEY=VALUE`.

## 4. Verify once

```bash
git add -A && ./scripts/security-checks.sh --offline
node <kit>/bin/harness.mjs update . --check
```

The gate must pass. `--check` must exit 0, or list only what the user chose to leave: say which.

## 5. Hand over

- Do not commit unless the user asks. An update rewrites files every session executes, and the manifest that HD-1 compares them with: it is read by a human before it lands, and never merged unattended.
- In the pull request description: the kit version and commit before and after (`.claude/harness.json`, `kit`), the scope, the files merged, the conflicts left and why, the "By hand" items done or left.
- A "By hand" item or a post-install step that acts on a person's machine rather than on the project — installing a tool, starting a process, writing under `~` or into a shell profile, pointing sessions somewhere — is relayed word for word, never done by this session. Only the items that change the project's own files, such as a seed, are done here, on the user's yes.
