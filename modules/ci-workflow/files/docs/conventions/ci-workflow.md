# The CI workflow skeleton

**Rule:** `.github/workflows/ci.yml` runs on every pull request and every push to the default branch, with no path filter. Its first job calls `security.yml` and always runs; a `changes` job says whether anything outside the documentation set changed, and the project's costly jobs wait for it and are skipped when nothing did (CW-1 to CW-3).

## Status

The call to `security.yml`, the `edited` type and the triggers are the ones `security-workflow.md` § Wiring describes. An earlier shape of this file, with a path filter instead of the `changes` job, ran live once, on 2026-11-12, in a throwaway private repository (the kit at commit `e677e3d`), with one test job added after the call: the `edited` event of a pull request retargeted onto the default branch started a run, as described below. The current shape — no path filter, the `changes` job, its guard — is unit-tested only: the guard runs the `changes` script on a table of changes built in scratch repositories, and the kit's tests run the guard on broken copies of this file. It has not run live. In your repository, open one pull request that only touches a Markdown file and check that the run starts, that `Security` runs and that your own jobs are skipped.

## Why

A project that installs the security workflow still has to write the workflow that calls it, and until it does the enforcing tier does not run on pull requests at all. The call is the same in every project; only the jobs after it depend on the stack. So the call is shipped, and the jobs are left as a marked gap.

A path filter on the triggers looks like the cheap way to spare the build on documentation. It breaks three things:

- **Required checks.** Where a ruleset requires the CI checks, a pull request the workflow skips never gets them: a required check that never reports blocks the merge, and only a bypass lands the pull request. A ruleset cannot exempt paths from a required check.
- **Unattended merges.** Where the `auto-merge` module is installed, a merge waits for a green CI run (AM-11); a pull request with no run waits forever.
- **The secret scan.** A token pasted into a runbook is a change to a Markdown file. Skipped by CI, it lands unscanned; the first scan is the next scheduled run.

So the workflow runs on everything, and the decision moves from the trigger to the jobs. GitHub counts a job skipped by its `if:` as a passing required check, so a documentation-only pull request still gets every check a ruleset requires, and pays only for the jobs that ran: the security call and the `changes` job.

## Details

- **`security`** calls `security.yml`: gitleaks over the full history, then the gate. It never waits for `changes` and is never skipped by it (CW-2): documentation is scanned too, and the gate checks `CLAUDE.md` and the agent definitions, which are Markdown.
- **`changes`** checks out the commit with its parents (`fetch-depth: 2`) and writes one output, `code`. On a pull request, `HEAD` is the merge commit GitHub built, compared with its first parent, the base; on a push, the commit pushed when it is the only one, its parent being the tip before the push. `code` is `'false'` only when that diff was read and every file in it is in the documentation set: `docs/**`, any `*.md`, `LICENSE`, `.gitignore`. Anything else is `'true'`: code, a rename (listed as a deletion and an addition, so code moved into `docs/` counts), a quoted file name, an empty diff, a push of several commits, a scheduled or manual run, a commit that is not a merge commit, no repository. It runs on `ubuntu-slim`, GitHub's one-CPU runner (git, jq, the GitHub CLI and Node.js are on it), for a few seconds.
- **The project's jobs** declare `needs: [security, changes]` and `if: needs.changes.outputs.code == 'true'`. A job that must also run on documentation, a link checker say, leaves the `if:` out. If `changes` fails, the jobs that wait for it are skipped and the run is red: nothing merges on it.
- **The documentation set** is written once, in the script. Widening it (a `site/` directory of static pages, say) is an edit of this file; CW-3's table keeps checking that code and workflows still count as code.
- **The name** on the first line is the one given at installation (`CI` by default). Anything that waits for this workflow waits for that exact name; a ruleset requires its jobs by their names (`Security / Enforcing (gitleaks + gate)`, and yours).
- **A project without code** keeps the file as installed: the gate and the `changes` job. The `TODO(harness)` block stays until there is something to build or test.
- **This file is a seed**: the kit never overwrites it. A project that already has a CI workflow does not need this module; it adds the call to its own, and the same `changes` job if it wants the saving.

### Retargeted pull requests

The `pull_request` trigger lists `edited` on top of GitHub's default types (`opened`, `synchronize`, `reopened`). A pull request retargeted to the default branch is an `edited` event: without it, no run of this workflow would test it against the default branch, and the only run of its commit could be one that a pull request into another branch started, from that branch's copy of this file. The `auto-merge` module fails its gate (AM-9) on a CI workflow without it. The price: a title or description edit re-runs CI.

## Checks

`scripts/guards.d/31-ci-workflow.sh`:

- **CW-1** — `on:` names `pull_request` and `push`, and no trigger has a `paths` or `paths-ignore` filter.
- **CW-2** — a job calls `security.yml`; that job needs no other job, and its `if:`, if it has one, does not read `changes`.
- **CW-3** — when there is a `changes` job: its one output is `code: ${{ steps.diff.outputs.code }}`; the step `id: diff` sets `EVENT` and `BEFORE` from the event; its run block is the script between `# harness:changes-begin` and `# harness:changes-end`, and nothing else. That script is run with `bash -e`, as a runner runs it, on sixteen changes built in scratch repositories: `'false'` for a pull request that edits `docs/` or `README.md` and for a single-commit push that edits `docs/`, `'true'` for the thirteen others (code, docs and code, code moved into `docs/`, a workflow, a quoted name, an empty change, no merge commit, a single-commit push of code, a push of two commits, a push whose previous tip is unknown, a scheduled run, a manual run, no repository). Each row must write exactly one `code=` line. Without `changes`, the guard notes that every job runs on every change.
- **GA-1, GA-2** apply to this workflow like any other.

## History

- Installed with the kit.
- `edited` added to the `pull_request` types, so that a retargeted pull request gets its own run.
- First live run (§ Status): the path filter and the `edited` type behaved as described.
- The path filter is gone. With a ruleset that requires the CI checks, a documentation-only pull request got no run, so its required checks never reported and it could not be merged without a bypass; and documentation was never scanned for secrets on its way in. The workflow now runs on every pull request and push; a `changes` job, failing closed, lets the costly jobs skip on documentation; CW-1 to CW-3 guard that shape. Unit-tested only.
