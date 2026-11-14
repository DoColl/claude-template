# Ready on green — a draft is lifted when CI signs off

**Rule:** `.github/workflows/ready-on-green.yml` marks a draft pull request ready for review once the `__HARNESS_CI_WORKFLOW__` workflow is green on its head commit. It does nothing else: it never merges, approves, comments or pushes. A pull request labelled `session-active` keeps its draft: a session is still at work on it.

Files: `.github/workflows/ready-on-green.yml`, `scripts/guards.d/41-ready-on-green.sh`.

## Status

**Run live on the kit's own repository: refused twice, then drafts lifted once the fix was on the default branch.** On the first draft pull request after the workflow reached a default branch, the job took the green run and skipped the cancelled one, found the pull request and its head — and GitHub refused the call: `markPullRequestReadyForReview` is not accessible to a job token that holds `pull-requests: write` alone. `auto-merge.yml`, which lifts drafts, holds `contents: write` as well; the job now holds both. The call was refused a second time on the commit that added it: a `workflow_run` workflow runs as the default branch has it, and the change was not there yet. Once it was, on 2026-11-13, the runs that green CI runs started lifted the drafts of several pull requests, each at the head CI had validated; they left pull requests that were not drafts alone, and skipped a commit whose pull request had been merged before its CI ended. On 2026-11-14 the `session-active` label held a draft: CI ended green on a labelled draft, and the run left it a draft, with its notice. Not exercised: a head that moved after CI, a branch written by a CI Claude session, two open pull requests on one commit. A CI workflow that holds its jobs while the label is on (§ A CI workflow that holds its jobs) is the kit's own CI; it has not run live yet.

## Why

A session opens its pull requests as drafts, so that nothing takes one for mergeable before the checks have run. Once CI is green the draft says nothing any more, and it costs whoever merges a click per pull request. `auto-merge` lifts the draft itself, as a step before its merge; a repository that cannot install `auto-merge` — it needs an enforced ruleset on the default branch — had nothing.

## Details

- **What a draft means here.** With this workflow, a draft means "CI has not signed off" — or, with the `session-active` label, "a session is still at work on it" (§ A session still at work). Without the label, an author who wants to hold a pull request says so in its title or a comment; the draft will not hold it.
- **Never unattended beyond that.** Lifting a draft merges nothing. Where the repository requires a review before a merge, it still does.
- **Only the validated head.** The pull request is the open one, into the default branch, whose head is exactly the commit CI ran on; with two such pull requests, none is touched. The head is read again just before the call: a commit pushed since has its own run.
- **Forks are out of scope.** The job takes runs whose head repository is this repository.
- **A branch a CI Claude session wrote keeps its draft** (`claude/issue-*`, `claude/rework-*`): opening its pull request is not reading it.
- **Documentation-only pull requests keep their draft.** Where the CI workflow skips documentation, no run ends, and nothing starts this workflow. The alternative is a `pull_request` trigger, which runs the workflow file as the pull request writes it, with a write token: RG-1 refuses it.
- **Not with `auto-merge`.** Both would lift the same draft; install one.

### A session still at work

A session opens its pull request early, so that the other sessions see what it holds, and may still have work to do on it: a review running, a commit to come. Green CI on its first commit is not that work done, and a lifted draft reads as mergeable. A pull request was once merged while the session that wrote it was still reviewing it.

Such a session labels its pull request `session-active` when it opens it, and the workflow leaves the draft alone whatever CI says, with a notice in its log. When its work is done — its last commit pushed, its own checks over —, the session removes the label. What follows depends on the CI workflow:

- **CI that runs in full on every push**, as it comes: removing the label runs nothing. If CI is still running on the head, the workflow lifts the draft when the run ends green; if it has already ended green, the session lifts the draft itself (`gh pr ready`). Never before CI is green on the head: that is the one thing a draft still says here.
- **CI that holds its jobs while the label is on** (below): removing the label runs CI once, in full, and the workflow lifts the draft when that run ends green. The session does nothing more, and never lifts the draft by hand.

A session that ends without removing the label — its context spent, a crash — leaves the pull request a draft, which GitHub does not merge: the safe side. Whoever finds it removes the label, and the draft comes off once CI is green on the head: lifted by the workflow if CI runs again, by hand if it does not. A person can use the label the same way.

Create the label once: `gh label create session-active --description "A session is still at work on this pull request"`. The label is read when the run ends, with the pull request; one added in the seconds between that read and the call does not hold the draft.

### A CI workflow that holds its jobs

While a session works, each of its pushes runs CI in full on a commit nobody will merge as it is. The CI workflow can hold its jobs instead, and run them once, when the label comes off:

```yaml
on:
  pull_request:
    # The types the workflow already lists (`edited`, say), plus the last two.
    types: [opened, synchronize, reopened, unlabeled, ready_for_review]

jobs:
  test: # and every other job, with the same line
    if: ${{ !(github.event.pull_request.draft && contains(github.event.pull_request.labels.*.name, 'session-active')) }}
```

- **Every job carries the condition.** A run whose jobs are all skipped ends `skipped`, and this workflow, like any other that acts on a green CI run, acts on `success` only. A run where one job ran and the others were skipped ends `success`: if the label came off between the end of that run and this workflow's read of the pull request, the draft would be lifted on checks that never ran.
- **Drafts only.** GitHub does not merge a draft, but it counts a skipped job as passed for a required check: a held pull request that could be merged would go through untested. A pull request that is not a draft runs CI in full, label or not, and `ready_for_review` runs it when a held draft is lifted by hand. A draft this workflow lifts starts no run (§ Limits).
- **`unlabeled` fires for any label.** Another label taken off a held draft runs nothing; taken off a pull request that is not held, it runs CI again, in full.
- **The price.** What CI runs first — a secret scan, the gate — no longer runs on each push while the label is on, only once at the end, before the draft is lifted. A secret pushed in between is found then, not at once: the gate run before each push stays the first line.

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
- **RG-4** — the `session-active` label is read with the pull request and checked before the pull request is named to the step that lifts the draft.

## History

- Written for the kit from the draft-lifting steps of `auto-merge.yml`, for repositories that do not install that module.
- First live run: the call was refused with `pull-requests: write` alone. `contents: write` added, RG-2 changed with it.
- Refused again on the commit that added `contents: write`: a `workflow_run` workflow runs as the default branch has it. Once the change was there, drafts were lifted, each at its validated head.
- A pull request labelled `session-active` keeps its draft (RG-4): a pull request had been merged once its CI was green and its draft lifted, while the session that wrote it was still reviewing it.
- What follows when the label comes off, and a CI workflow that holds its jobs while it is on: each push of a session at work ran CI in full, on commits nobody would merge as they were. Every job holds, so that a held run ends `skipped`, never `success` on checks that never ran.
