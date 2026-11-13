# docs/conventions — the detail behind CLAUDE.md

`CLAUDE.md` is loaded into every Claude Code session, so it carries operative rules only and stays under a byte budget. Each file here holds what would otherwise be a long bullet of `CLAUDE.md`: the full rule, the reasons behind it and its history (incidents, pull requests, dates). `CLAUDE.md` points at the file; read it when you work in that area.

Decisions that outlive their context (a technology, a pattern, a trade-off) go to `docs/adr/`. Procedures someone will follow under pressure go to `docs/runbook/`.

## Adding a convention

1. Copy `_template.md` to `<slug>.md` and fill it in.
2. Add a bullet of at most 400 bytes under "Key conventions" in `CLAUDE.md`, ending with `→ docs/conventions/<slug>.md`. A rule that only concerns some files goes to `.claude/rules/<slug>.md` with a `paths:` list instead (`claude-md.md` § Path-scoped rules).
3. Add a row to the index below.
4. If the rule can be checked mechanically, add the guard and name its ID in the file.

## Index

| File | Topic | Source |
|---|---|---|
| `claude-md.md` | CLAUDE.md as a budgeted index: byte budget, pointers, what goes where | CM-1, CM-2 |
| `local-gate.md` | The gate, the guards directory, IDs for findings, kit files and their hashes | HD-1 |
| `review-tiers.md` | Which review a diff gets before a push: three tiers by what the change can do | — |
<!-- harness:rows conventions-index -->
<!-- TODO(harness): one row per convention of your own. -->
