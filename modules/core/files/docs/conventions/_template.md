# <Topic>

**Rule (CLAUDE.md § Key conventions):** the rule as `CLAUDE.md` states it, in one or two sentences. For a rule scoped to some files, name its `.claude/rules/<slug>.md` and the paths that load it instead.

## Why

What went wrong, or would go wrong, without it. Name the incident, the pull request or the review finding: a rule with a story is a rule people keep.

## Details

The parts that did not fit in five lines: edge cases, the exact API or file layout, how the pieces interact, what is deliberately allowed.

## Checks

The guard IDs that enforce the rule (`scripts/guards.d/…`), or the tests that do. If nothing enforces it, say so: an unchecked rule is the first to drift.

## History

- yyyy-mm-dd — what changed and why (PR number).
