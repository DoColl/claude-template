# Ready on green — a draft is lifted when CI signs off

**Rule:** `.github/workflows/ready-on-green.yml` marks a draft pull request ready for review once the `__HARNESS_CI_WORKFLOW__` workflow is green on its head commit. It does nothing else: it never merges, approves, comments or pushes.

Files: `.github/workflows/ready-on-green.yml`, `scripts/guards.d/41-ready-on-green.sh`.

## Status

**Run live on the kit's own repository: it failed once, then the fix worked.** On the first draft pull request after the workflow reached a default branch, the job took the green run and skipped the cancelled one, found the pull request and its head — and GitHub refused the call: `markPullRequestReadyForReview` is not accessible to a job token that holds `pull-requests: write` alone. `auto-merge.yml`, which lifts drafts, holds `contents: write` as well; the job now holds both. On 2026-11-13, with both, the run that a green CI run started found the draft pull request whose head was the commit CI had validated and marked it ready for review. Not exercised: a head that moved after CI, a branch written by a CI Claude session, two open pull requests on one commit.

## Why

A session opens its pull requests as drafts, so that nothing takes one for mergeable before the checks have run. Once CI is green the draft says nothing any more, and it costs whoever merges a click per pull request. `auto-merge` lifts the draft itself, as a step before its merge; a repository that cannot install `auto-merge` — it needs an enforced ruleset on the default branch — had nothing.

## Details

- **What a draft means here.** With this workflow, a draft means "CI has not signed off", not "the author is not done". An author who wants to hold a pull request says so in its title or a comment; the draft will not hold it.
- **Never unattended beyond that.** Lifting a draft merges nothing. Where the repository requires a review before a merge, it still does.
- **Only the validated head.** The pull request is the open one, into the default branch, whose head is exactly the commit CI ran on; with two such pull requests, none is touched. The head is read again just before the call: a commit pushed since has its own run.
- **Forks are out of scope.** The job takes runs whose head repository is this repository.
- **A branch a CI Claude session wrote keeps its draft** (`claude/issue-*`, `claude/rework-*`): opening its pull request is not reading it.
- **Documentation-only pull requests keep their draft.** Where the CI workflow skips documentation, no run ends, and nothing starts this workflow. The alternative is a `pull_request` trigger, which runs the workflow file as the pull request writes it, with a write token: RG-1 refuses it.
- **Not with `auto-merge`.** Both would lift the same draft; install one.

### Why `workflow_run`

GitHub reads a `workflow_run` workflow from the default branch, whatever the pull request contains: a pull request cannot change what runs here. The price is a token with write permissions on an event anyone who can open a pull request causes. The workflow therefore checks nothing out, runs no action, takes one value from the event — the head commit, checked to be 40 hexadecimal characters — and holds the two permissions the call needs, `pull-requests: write` and `contents: write`. zizmor reports the trigger (`dangerous-triggers`); the finding is silenced on that line, for these reasons.

## Limits

- `contents: write` lets a job token push commits, tags and branches wherever no ruleset forbids it, and `pull-requests: write` also allows editing, closing and commenting on pull requests. Lifting a draft needs both; nothing here uses the rest. The workflow does none of it, and RG-2 fails if a call other than `gh pr list`, `gh pr view` and `gh pr ready` appears — a guard on the text of the file, which a pull request that edits both the file and the guard defeats. Review of the workflow is what covers that.
- A draft lifted by the job token starts no other workflow: GitHub does not run workflows for events its own token causes.
- If the call fails, the run shows a warning and the pull request stays a draft.

## Guards

`scripts/guards.d/41-ready-on-green.sh`:

- **RG-1** — the only trigger is `workflow_run`.
- **RG-2** — no checkout, no action, no merge, review, comment or push; `permissions: {}` at the top and two permissions in the job, `pull-requests: write` and `contents: write`.
- **RG-3** — every job takes green `pull_request` runs of this repository only and refuses the branches a CI Claude session wrote; each `gh pr ready` follows a comparison of the head with the validated commit.

## History

- Written for the kit from the draft-lifting steps of `auto-merge.yml`, for repositories that do not install that module.
- First live run: the call was refused with `pull-requests: write` alone. `contents: write` added, RG-2 changed with it.
- Second live run, with both permissions: the draft was lifted.
