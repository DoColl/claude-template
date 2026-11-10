# CLAUDE.md as a budgeted index

**Rule (CLAUDE.md § Key conventions):** `CLAUDE.md` holds operative rules only and stays under the byte budget declared on its `harness:budget` line; every `docs/` path it names must exist. A new rule is a short bullet plus a detail file here.

## Why

`CLAUDE.md` is injected into every session and into every sub-agent that does not opt out. Each line is paid for on every turn, by every agent, and competes for attention with the task at hand. Left alone the file only grows: each incident adds a paragraph, nobody removes one, and the rules that matter end up buried in the history of the ones that no longer do.

A size target written in a document does not hold either. The budget is therefore a check (CM-1): going over fails the gate and CI, and raising the budget is a visible, reviewed change to `CLAUDE.md` itself rather than a slow drift.

## Details

- **What stays in `CLAUDE.md`**: what a session must know before touching anything — the map, the commands, the invariants, the review chain, the doc-sync table. One bullet per rule, five lines at most, ending with `→ docs/conventions/<slug>.md`.
- **What moves out**: the reasons, the incident that produced the rule, version-by-version history, long examples. They go to the convention file, which is read on demand.
- **The budget line**: `<!-- harness:budget 25000 -->` near the top of the file. Bytes of the raw file, comments included — simple to check and conservative. Block-level HTML comments are not sent to the model, so maintainer notes and the kit's to-do comments cost budget but no context.
- **Slots**: lines such as `<!-- harness:slot delegation -->` or `<!-- harness:rows conventions -->` mark where a kit module inserts its section or bullet when it is added later. Keep them; they are comments.
- **Line count**: the Claude Code documentation recommends keeping each `CLAUDE.md` short (it gives a line target rather than a byte one). The byte budget is this kit's choice of something a script can enforce; set it to what your project can defend.
- **Nested `CLAUDE.md` files** (per directory) are not covered by CM-1. If you add one, give it its own budget line and extend the guard.

## Checks

- **CM-1** — the budget line exists and the file is not larger than it (`scripts/guards.d/10-claude-md.sh`).
- **CM-2** — every `docs/….md` path named in `CLAUDE.md` exists.

## History

- Installed with the kit.
