bump: minor

- `core`: new advisory guard `RR-1` (`scripts/guards.d/12-review-record.sh`) reads the `## Review record` section of a pull request description and notes when it is missing or does not name the head the pull request has now. It skips unless `PR_BODY_FILE`, or `PR_BODY` with `PR_HEAD_SHA`, is set, so a run on a laptop is unchanged; `REVIEW_RECORD=enforce` makes it a failure. `docs/conventions/review-tiers.md` § Checks and `local-gate.md` describe it.
- `ci-security`: the gate step of `security.yml` passes the pull request's description and head to the gate through `env:` (never inside `run:`), so RR-1 runs on pull requests.

By hand: nothing. A project with its own gate step (not `security.yml`) adds `PR_BODY: ${{ github.event.pull_request.body }}` and `PR_HEAD_SHA: ${{ github.event.pull_request.head.sha }}` to that step's `env:` to get the check; it stays advisory until `REVIEW_RECORD: enforce` is set there.
