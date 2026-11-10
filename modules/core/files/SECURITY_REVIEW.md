# Security review — findings catalogue

What has already gone wrong here once, and the check that keeps it from coming back. Reviewers read this file before a diff; `scripts/guards.d/50-project.sh` replays it on every push and in CI.

## How to use it

1. A review pass, an incident or a bug report produces a finding. Give it a stable ID (a letter for the severity and a number — `C1`, `H2`, `M3`, `L4` — or a prefix per review round).
2. Fix it, with the regression test that failed before the fix.
3. Add its row below, and a check carrying the same ID in `scripts/guards.d/50-project.sh`. A finding that cannot be expressed as a cheap check says so in the "Guard" column, with the test that covers it instead.
4. Never delete a row: a fixed finding is the record that the class of bug exists in this codebase.

A later review round gets its own file (`SECURITY_REVIEW_<yyyy-mm>.md`) with the same table; this one stays as the first.

## Findings

| ID | Severity | Finding | Fix | Guard | Status |
|---|---|---|---|---|---|
<!-- TODO(harness): first row once the first finding is fixed, e.g.
| H1 | high | CSV export cells were not neutralised against formula injection | #12 | `50-project.sh` H1 | fixed |
-->

## Derogations

A finding left open on purpose is recorded here, never silently: which finding, why not now, who decided, the review date.

| ID | Reason | Decided by | Review by |
|---|---|---|---|
