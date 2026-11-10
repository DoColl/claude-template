# CLAUDE.md

<!-- harness:budget __HARNESS_CLAUDE_MD_BUDGET__ -->
<!--
  Operative rules only. This file is loaded into every session and into every
  sub-agent that does not opt out, so it stays under the byte budget declared
  above (guard CM-1 fails the gate past it). Detail, history and reasons go to
  docs/conventions/<slug>.md; a rule here is at most five lines and ends with a
  pointer to that file. Block-level HTML comments such as this one are not sent
  to the model: they are notes for whoever edits the file.
-->

Guidance for Claude Code in the __HARNESS_PROJECT_NAME__ repository. This file holds the **operative rules only**: the detail, history and reasons behind each rule live in the file the rule points to — read that file when you touch the area.

## Project overview

<!-- TODO(harness): three lines — what the product is, who uses it, where the full specification lives. -->

## Architecture

<!-- TODO(harness): the map — top-level directories, the layering rule, where a new module goes. Point to ARCHITECTURE.md for the rest. -->

## Commands

<!-- TODO(harness): the exact commands to build, lint, test and run, per workspace. -->

```bash
./scripts/security-checks.sh            # the local gate: every guard in scripts/guards.d/
./scripts/security-checks.sh --offline  # same, without the checks that need the network
```

<!-- harness:slot delegation -->
## Key conventions

<!-- One bullet per rule — **Name**: the rule, at most five lines. → `docs/conventions/<slug>.md` -->
<!-- TODO(harness): the project's own conventions (data model invariants, API error format, naming, what must never be logged). -->
- **CLAUDE.md stays a budgeted index**: operative rules only, under the byte budget on its `harness:budget` line (CM-1); every `docs/` path it names must exist (CM-2). A new rule is a short bullet here plus its detail file. → `docs/conventions/claude-md.md`
- **A rule that matters is a check**: every fixed bug or review finding gets an ID, a line in `SECURITY_REVIEW.md` and a guard in `scripts/guards.d/`; the gate and CI run the same guards. → `docs/conventions/local-gate.md`
<!-- harness:rows conventions -->

## Environment variables

<!-- TODO(harness): only the variables with a safety edge (fail-closed switches, keys whose loss is data loss, flags that must never be true in production). The full list belongs in .env.example and the README. -->

## Security workflow

<!-- harness:slot security-workflow -->
### Before pushing

Always run `./scripts/security-checks.sh`. The review before it depends on what the diff touches; the highest tier that applies wins. Size is no proxy for risk: removing a guard is one line. → `docs/conventions/review-tiers.md`

| Tier | The diff touches | Review |
|---|---|---|
| 1 | Documentation and the wording of instructions: `docs/**`, `**.md`, the prose of `CLAUDE.md`, of an agent or of a skill | Re-read the diff once. No review pass. |
| 2 | Harness code that runs: `scripts/**`, `.githooks/**`, `.claude/hooks/**`, `.github/workflows/**`; and any change to what a session may do — an agent's or a skill's frontmatter, `.claude/settings.json`, `.mcp.json`, a rule of this section or of a merge gate removed or weakened | The passes marked 2. |
| 3 | Application code in a sensitive area, listed below | Every pass. |

<!-- TODO(harness): list the sensitive areas with their paths — authentication and authorization, writes on user data, external I/O (controllers, exports, integrations), configuration (env vars, container files). -->

Passes, in this order, each **once**, on the complete diff; after fixing a finding, re-run the gate, not the chain:

   <!-- harness:rows before-pushing -->
1. **`/security-review`** (tiers 2, 3) — security review of the pending changes.
1. **`/code-review`** (tier 3) — correctness and maintainability.
1. **`/simplify`** (tier 3, only when the fixes of the earlier passes added code) — duplication or premature abstraction they introduced.

Instruction files are executed by every session: in doubt between tiers 1 and 2, it is tier 2.

### Findings policy

Every finding raised by a review pass, by the gate or by CI is fixed before the change is merged. The only exception is an explicit, motivated derogation from the project owner, recorded in the pull request (which finding, why not now, the follow-up). A rejected finding needs a stated reason. Once fixed, a finding gets its ID, its line in `SECURITY_REVIEW.md` and its guard.

### Conventions for new code

<!-- TODO(harness): the invariants reviewers check on every diff, one line each. Typical ones: an ownership check before any write that takes an id from the request; an audit entry on every mutation; bounds on every input (length, range, array size); output encoding for exports; cryptography from the standard library only; errors that never echo internals. -->

## Documentation maintenance

Doc and code stay in sync at every commit on the default branch: when a change affects behaviour, structure, conventions or operations, the matching doc changes in the same commit.

- New module or endpoint → `ARCHITECTURE.md` (and the generated API description, if any)
- Schema or migration → the data-model section of the specification
- New environment variable → `.env.example` and the README
- New convention or constraint → a short bullet under "Key conventions" plus `docs/conventions/<slug>.md` and its row in `docs/conventions/README.md`
- CI or deployment change → the README's deployment section
- Operational procedure → `docs/runbook/`
- Architectural decision → a new ADR in `docs/adr/`
- Finding remediated → `SECURITY_REVIEW.md` and its guard
<!-- harness:rows doc-maintenance -->

## Working rules

- One git worktree per task. Never switch branches, reset or reinstall dependencies in a checkout another session may be using.
- `git fetch` and branch from the remote default branch: a clean `git status` does not mean up to date.
- After editing `CLAUDE.md`, an agent or a hook, restart the open sessions — a running session may keep the instruction files it started with.
- Remove a worktree once its branch is merged.

## Out of scope

<!-- TODO(harness): what must not be built yet, so nobody (human or model) starts it by accident. -->

## Version history

<!-- TODO(harness): one row per release — version, what shipped, what is still open. -->
