# CLAUDE.md as a budgeted index

**Rule (CLAUDE.md § Key conventions):** `CLAUDE.md` holds operative rules only and stays under the byte budget declared on its `harness:budget` line; every `docs/` path it names must exist. A new rule is a short bullet plus a detail file here — or, when it only concerns some files, a path-scoped rule in `.claude/rules/`.

## Why

`CLAUDE.md` is injected into every session and into every sub-agent that does not opt out. Each line is paid for on every turn, by every agent, and competes for attention with the task at hand. Left alone the file only grows: each incident adds a paragraph, nobody removes one, and the rules that matter end up buried in the history of the ones that no longer do.

A size target written in a document does not hold either. The budget is therefore a check (CM-1): going over fails the gate — and CI, once a workflow runs the gate — and raising the budget is a visible, reviewed change to `CLAUDE.md` itself rather than a slow drift.

## Details

- **What stays in `CLAUDE.md`**: what a session must know before touching anything — the map, the commands, the invariants, the review chain, the doc-sync table. One bullet per rule, 400 bytes at most, ending with `→ docs/conventions/<slug>.md`.
- **What moves out**: the reasons, the incident that produced the rule, version-by-version history, long examples. They go to the convention file, which is read on demand. A rule that only concerns some files moves to a path-scoped rule (below).
- **The budget line**: `<!-- harness:budget 25000 -->` near the top of the file. It bounds what a session loads at launch: the bytes of `CLAUDE.md` minus its block-level HTML comments, plus every unscoped rule file.
- **Comments are free, narrowly**: Claude Code strips block-level HTML comments from `CLAUDE.md` before injecting it, so maintainer notes and the kit's to-do comments cost no context, and no budget. CM-1 subtracts only the comments it is sure of: opening at column 0, outside a fenced code block, with the closing `-->` ending its line. An inline comment, an indented one (a slot marker inside a list), one followed by text or one never closed stays in the count.
- **Slots**: lines such as `<!-- harness:slot delegation -->` or `<!-- harness:rows conventions -->` mark where a kit module inserts its section or bullet when it is added later. Keep them; they are comments.
- **Line count**: the Claude Code documentation recommends keeping each `CLAUDE.md` short (it gives a line target rather than a byte one). The byte budget is this kit's choice of something a script can enforce; set it to what your project can defend.
- **Nested `CLAUDE.md` files** (per directory) are not covered by CM-1. If you add one, give it its own budget line and extend the guard.
- **A directory that is not for this session** — templates the project ships to others, vendored code, a fixture repository: Claude Code loads its `CLAUDE.md` and its `.claude/rules/` once a session reads a file there. List it under `claudeMdExcludes` in `.claude/settings.json` (globs matched against absolute paths, so start them with `**/`). That setting does not reach skills: a `.claude/skills/` below the root is still offered as a directory-scoped variant, so say in `CLAUDE.md` which skills are this project's.

### Path-scoped rules

A file under `.claude/rules/` whose frontmatter has a `paths:` list is loaded only once a session reads, writes or edits a file matching one of the globs:

```markdown
---
paths:
  - ".github/workflows/**"
---

# GitHub Actions

The rule, as short as a bullet. → `docs/conventions/<slug>.md`
```

- **When to use one**: the rule is about the content of files at known paths, and a session that never opens them has no use for it — a workflow syntax rule, a schema rule, a rule for one directory. It then costs nothing in the sessions that work elsewhere.
- **When not to**: the rule is about behaviour — what to run before pushing, what never to merge, how to brief an agent. Nothing a session opens would load it in time. It stays a bullet.
- **It arrives with the file, not before**: a session that creates a matching file from nothing gets the rule once the file is written. Keep a path-scoped rule for what a guard also checks, or what can be corrected after the first write.
- **After a compaction** `CLAUDE.md` is re-read at once; a path-scoped rule comes back the next time a matching file is touched.
- **A rule file without `paths:` is not scoped**: it is loaded at launch, exactly like `CLAUDE.md`. CM-1 adds its bytes to the count, so it is no way around the budget. A frontmatter that does not parse is treated by Claude Code as no frontmatter; the guard only looks for a `paths:` key.
- **Globs** are relative to the directory that holds `.claude/`. `.claude/rules/` is tracked: the kit's `.gitignore` block re-includes it.
- **The kit's modules** ship their file-bound rules this way (GitHub Actions, Dependabot, session settings, the OpenSpec layout). Those files are the kit's: `update` refreshes them, where a bullet inserted in `CLAUDE.md` is yours from the day it lands.

### Limits

- The definitions above come from the Claude Code documentation. The kit's authors have not watched a path-scoped rule load in a live session, in a sub-agent or in a CI session; the guard and the tests check the files, not the runtime. Check once: open a file a rule names and ask the session which rules it was given. The same holds for `claudeMdExcludes`: its behaviour is taken from the documentation (code.claude.com, "Exclude specific CLAUDE.md files", read 2026-11-15).
- A reviewer that is told to judge a diff against `CLAUDE.md` reads the path-scoped rules only if its session loads them. The rules the kit moved there are each backed by a guard of the gate.

## Checks

- **CM-1** — the budget line exists and what a session loads at launch is not larger than it: `CLAUDE.md` without its block-level comments, plus the rule files that have no `paths:` (`scripts/guards.d/10-claude-md.sh`). The guard prints the three numbers.
- **CM-2** — every `docs/….md` path named in `CLAUDE.md` exists.

Nothing checks that a path-scoped rule's globs match a file that exists, nor the 400 bytes of a bullet the project writes itself (the kit's own bullets are held to it by its tests).

## History

- Installed with the kit.
