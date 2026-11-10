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

If the diff touches any of the areas below, run the review chain, in order, then the gate. Size is no proxy for risk: removing a guard is one line.

<!-- TODO(harness): list the sensitive areas with their paths — authentication and authorization, writes on user data, external I/O (controllers, exports, integrations), configuration (env vars, CI workflows, container files). -->

<!-- harness:rows before-pushing -->
1. **`/security-review`** — security review of the pending changes.
1. **`/code-review`** — correctness and maintainability.
1. **`/simplify`** — duplication or premature abstraction introduced by the fixes.

Then `./scripts/security-checks.sh`. Changes to the instruction files themselves (`CLAUDE.md`, `.claude/**`, `.githooks/**`) count as sensitive: every session executes them.

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
