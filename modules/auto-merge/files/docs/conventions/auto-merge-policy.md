# Auto-merge policy

**Rule (CLAUDE.md § Security workflow › Auto-merge policy):** every pull request whose `__HARNESS_CI_WORKFLOW__` run is green is squash-merged, pinned to the commit CI validated, and its head branch is deleted; a pull request whose every file is documentation merges at once, without CI. Nothing that touches Claude instruction files, nothing from a CI Claude session's branch and no Dependabot bump the gate holds is ever merged unattended.

## Status

The workflow this module was ported from runs in production. This generic variant — the same two jobs, without the post-merge deploy dispatch and with the project-specific values turned into settings — **has not run live**. Its guard passes, and each of its checks was shown to fail on the change it is there to catch, but no pull request has gone through it: the first ones in your repository are its test. Watch the "Auto-merge after CI" runs on a docs-only pull request and on a code one before relying on it.

## Why

When one maintainer (or a few) works through several sessions in parallel, a green pull request waiting for a click is delay without control: nobody reads the diff at that moment, the CI already did the reviewing. So there is no heuristic here — green means merged — and what does need a human is named and held: the files every later session will execute, the branches a CI agent wrote, the dependency bumps that can break.

The price is that the CI workflow *is* the review. Whatever must hold before a change lands (tests, the security gate) has to be part of that workflow, and the limits below have to be acceptable to you.

## How it works

`.github/workflows/auto-merge.yml` has two jobs, one per trigger:

- **`promote-from-ci`** — `workflow_run` on `__HARNESS_CI_WORKFLOW__`, for pull requests with code. It acts only on a successful run that a `pull_request` event started, from a branch of this repository (never a fork).
- **`promote-docs`** — `pull_request` filtered on `docs/**`, `**.md`, `LICENSE`, `.gitignore`, for the pull requests a CI workflow that ignores those paths never runs on. Nothing to wait for, so it merges at once.

The merge is a synchronous server-side call (`PUT /repos/…/pulls/N/merge`, squash first, a merge commit as the fallback): no checkout, no local git, nothing from the pull request is executed. Native auto-merge (`gh pr merge --auto`) is not used because it depends on a repository setting GitHub does not offer on every plan for private repositories; since `workflow_run` only fires once CI has concluded, a synchronous merge leaves no window worth closing.

**A mixed docs + code pull request waits for CI.** GitHub's `paths` filter matches when *any* changed file matches, so such a pull request reaches `promote-docs` too. That job lists the files (REST, paginated, old and new path of every rename, count checked against `changed_files` — a gap fails closed) and merges only when **every** one is documentation; otherwise it leaves the pull request to `promote-from-ci`.

## What is never merged unattended

### Claude instruction files (AM-1)

`CLAUDE.md`, `.claude/agents/*.md`, `.claude/skills/**`, `.claude/settings.json`, a git hook: these are executed, not read. Every session that opens the repository loads them, an agent definition decides which tools a sub-agent may run, a settings hook runs a shell command on every matching tool call. Most of them are Markdown, so without a gate they would ride the docs fast path and merge in seconds with no CI and no human look — and a green CI proves nothing about them anyway. A session steered by content it read could widen an agent's tools or delete a rule, and every later session would load the result.

So neither job merges a pull request that touches a path matched by `CLAUDE_GATE_RE` (one pattern in the workflow's `env`, applied by both jobs): any `.claude/` directory at any depth and a bare `.claude` entry (a symlink); `CLAUDE.md` and `CLAUDE.local.md` anywhere; `.githooks/`; `.mcp.json`; the other files a Claude CI action reads as configuration from its working directory (`.claude.json`, `.ripgreprc`, `.gitmodules`, `.husky/`); what runs Claude in CI and this workflow — `.github/workflows/claude*.yml`, `auto-merge.yml` itself; the gate and every guard — `scripts/security-checks.sh` and `scripts/guards.d/**`, which git runs on each push through the pre-push hook, which the read-only agents run, and which enforce all of this; and `scripts/reviewed-plugins.json`, the record of which Claude Code plugin commits were reviewed. A pull request that adds a regression guard is therefore merged by hand too. The match is case-insensitive per path segment, because a case-insensitive file system turns `.Claude/agents/x.md` into `.claude/agents/x.md`. Review the list once and add what else your tooling executes.

Such a pull request stays open until someone merges it from the GitHub UI. A mixed one (code plus a `CLAUDE.md` bullet) waits too; keep the instruction change in the same pull request anyway, the hand merge is the price of the rule.

### Branches written by a CI Claude session

Both jobs refuse a `claude/issue-*` head in their `if:`. A Claude session running in CI wrote that branch, and opening its pull request is not reading it. Branches named `claude/<anything else>` by local sessions keep the normal path.

### Dependabot bumps the gate holds (AM-5)

A Dependabot pull request is not written by a maintainer, so the gate in `promote-from-ci` looks closer:

- **Every commit must be Dependabot's.** A commit pushed onto its branch would otherwise ride the exception unreviewed.
- **Patch and minor bumps merge.** Reading a minor's diff by hand was never the control. The CI is, and so is the `cooldown` in `.github/dependabot.yml`, which keeps a version published minutes ago out of version updates. The guard notes an update entry that has none.
- **Held:** a major (as the trailer says it, or as the version pair shows it — below 1.0 a minor is breaking, below 0.1 a patch is); a move to a pre-release; a version that is not a whole version token (a SHA, a digest); a **GitHub Action minor**, since an Action runs with the workflow's token and secrets; and any pull request whose trailer entries and `from X to Y` lines do not name the same set of dependencies, so a bump written in another shape cannot go unchecked.
- **One exception, off as shipped.** An entry typed `dependency-type: indirect` is a security update — version updates cover direct dependencies only, which is why AM-5 fails on the word `allow` in `dependabot.yml` — and its major can be the only fix. Such a major goes through unless the pull request touches a path matching `MAJOR_HOLD_RE` (`.github/` is always held). The shipped value `.` matches every path: every major waits for a hand merge. Narrow it to the directories whose dependencies the pull-request CI does not build or test (`'^(mobile|infra)/'`), or to `'^$'` when CI exercises everything. A direct dependency's major always holds; an empty or unusable pattern holds everything.

The verdict is read from Dependabot's commit message (the `updated-dependencies` trailer and the bump lines). The usual metadata action resolves the pull request from the event context, and `workflow_run` carries no pull-request payload, so it cannot be used here. Anything but an exact `merge` verdict holds.

## A held pull request is handed over (AM-4)

Once the gate has decided, `promote-from-ci` marks the pull request ready — whichever way it decided, and only while its head is still the commit CI validated. For a held pull request that is all that happens: the merge button works at once. `promote-docs` does the same for a gated docs-only pull request, whose hold point it is since no CI runs. **Ready is sticky**: nothing turns a pull request back into a draft, so a handed-over one stays ready after a later push, even while that push's CI is pending or red — read the head's checks before a hand merge.

## The merge is the commit CI validated (AM-6)

`find-pr` keeps only the open pull request whose head *is* the SHA of the green run (a `sha:` search also returns stacked and sibling pull requests), and every merge call passes that SHA. A commit pushed after CI finished gets a 409: no retry, no merge, the job ends green with a notice, and the new head's own run merges it. The SHA always comes from the triggering event, never from the pull request's current state — reading the current head would merge exactly the commit nobody tested.

## The gate judges what is merged (AM-7)

Pinning the merge is half of it. The gate must read the same commit. A listing of the pull request's *current* files describes whatever its head and base are at the instant of the call: someone with push rights — a steered session is enough — could move the head or retarget the base, let the gate list an innocent diff, and put things back before the merge call, which only checks that the head equals the validated SHA.

So the gate never lists the pull request live. One read gives its base, its head, its file count and its author; if the head is no longer the event's, the job stops. Files and commits then come from the immutable range `compare/<base commit>...<validated head>`, which no later push can change, and the file count must match the one read with that head: a truncated range (300 files, 250 commits) holds. The merge step re-reads the base branch right before merging and stops if the pull request was retargeted since.

`workflow_run` fires once per workflow it lists, so the list holds **one** name. Two names would merge as soon as either is green. Keep security checks in their own file if you like, but call it from the CI workflow as a reusable workflow so that one conclusion covers both.

## After the merge

**A merge made with `GITHUB_TOKEN` emits no `push` event** — GitHub's guard against workflows triggering workflows. Anything you run on a push to `__HARNESS_DEFAULT_BRANCH__` (a deploy, a post-merge test run) does not run after an auto-merge, and nothing reports that it did not. The symptom is a merged pull request that never shipped.

The workflow dispatches nothing by default, which leaves one honest limit: `__HARNESS_DEFAULT_BRANCH__` is not re-tested after an unattended merge. A pull request's CI validated its head merged with the default branch as it was when the run was created; if another pull request landed meanwhile, nothing has tested the two together until the next run on the default branch.

`workflow_dispatch` is the documented exception: it does create a run when invoked with `GITHUB_TOKEN`. To have a run follow each merge:

1. Give the target workflow an `on: workflow_dispatch` trigger (with a `merged_sha` input if it should know which merge started it).
2. In `promote-from-ci`, add `actions: write` to the job's permissions and, between the merge and the branch cleanup, a step conditioned on `${{ !cancelled() && steps.merge.outputs.merged == 'true' }}` that runs `gh workflow run <file> --ref __HARNESS_DEFAULT_BRANCH__ -f merged_sha="$MERGE_SHA"`, with `MERGE_SHA: ${{ steps.merge.outputs.sha }}` passed through `env:`. The cleanup stays last: a failed deletion must never cost the dispatch.
3. No loop: the dispatched run's event is `workflow_dispatch`, which `promote-from-ci` ignores.
4. If the dispatched run skips tests because "the pull request was green", it must not skip them when the default branch moved during the pull request's CI. Decide that **after** the merge (commits on the default branch since the CI run was created, minus the merge commit itself — decided before, two merges seconds apart both see "nothing moved"), fall back to the full run on any doubt, and have the target workflow honour the shortcut only while the default branch's head still is `merged_sha`. If it deploys, the deploy waits for every test job. These are the invariants AM-2 and AM-3 pinned in the workflow this one comes from; bring them back in `scripts/guards.d/40-auto-merge.sh` with the dispatch.

No `concurrency` group belongs on these jobs: GitHub keeps one running and one pending run per group and cancels the older pending one, so with three merges in a minute one pull request would silently not be merged. Concurrent runs are safe — the merge call is atomic per pull request.

## Head branch deletion

GitHub's "Automatically delete head branches" setting was observed not to apply to merges made with `GITHUB_TOKEN`, so both jobs delete the head ref themselves, under the `contents: write` they already hold:

- **Only after an actual merge.** The merge step sets `merged=true` only when the call succeeded; a deferred, held or failed pull request keeps its branch.
- **Guards:** a branch of this repository only; never the default branch; never a branch another open pull request is stacked on or opened from (GitHub would retarget or close it); only a name made of `[A-Za-z0-9._/@+-]`, since it becomes a URL path segment — anything else is left to a human with a warning.
- **Look before deleting:** an exact ref lookup first. A ref already gone is the goal reached (Dependabot deletes its own); a tip that differs from the merged head means someone pushed since the merge, and the branch is kept; a lookup or a deletion that fails fails the step and names the branch.

A session still working on a merged branch is unaffected: a push before the cleanup keeps the branch, a push after it recreates it, as after a hand merge.

## Three things that surprise

- **Draft does not pause a pull request.** `promote-from-ci` lifts the draft and merges. To hold a pull request, cancel its CI run (`gh run cancel <id>`) or close it; the draft badge only changes the GitHub UI.
- **A pull request touching `.github/workflows/**` may be refused at merge while CI is green.** GitHub can refuse to let `GITHUB_TOKEN` land a change to a workflow file without the `workflows` permission; the merge then fails five times and the auto-merge job goes red although the CI workflow is green — the failure is here, not in a test. Both outcomes have been observed with the same permissions, so check the job on such a pull request rather than assume. If it is refused, merge by hand. **Never grant `workflows: write`**: any green pull request could then rewrite the pipeline unattended.
- **Dependabot pull requests merge too**, unless the gate holds them (above). A held one stays open and is marked ready; the run's notice says why.

## Setting it up

- **The CI workflow.** A workflow named `__HARNESS_CI_WORKFLOW__` must exist and run on `pull_request`; until it does, only docs-only pull requests are merged (the guard notes it).
- **The docs paths live in three places that must agree:** `on.pull_request.paths` in `auto-merge.yml`, the `NON_DOCS` pattern in `promote-docs`, and what the CI workflow skips on both `push` and `pull_request` (a `paths-ignore` list, or `paths` with `!` exclusions). If CI does not skip them, a docs-only pull request is still merged at once, while its CI run is in flight.
- **CI may take instruction files back, and nothing else.** A CI workflow that skips `**.md` also skips `CLAUDE.md` and the agent definitions, so the gate never runs on a pull request that only edits them. Its `pull_request` filter may therefore re-include paths after the exclusions (`.claude/**`, `CLAUDE.md` at any depth). Every re-included path must be one `CLAUDE_GATE_RE` holds: `promote-docs` merges a docs-only pull request without waiting, so a re-included path it does not hold would be merged while the run CI just started is still in flight. For a held path there is no race — both jobs refuse it, and the CI run is there for whoever merges by hand.
- **Three decisions are left as to-do comments in the workflow:** the paths that are executed (`CLAUDE_GATE_RE`), where a Dependabot major may go through (`MAJOR_HOLD_RE`), and whether something must be dispatched after a merge.
- **Forks are out of scope by design**: both jobs act on branches of this repository only.

## Residual risks, accepted

- Documentation other than the gated files rides the docs fast path, including the convention pages `CLAUDE.md` sends sessions to: they are read, not executed, but nobody reviews them before they land.
- The gate holds the gate runner and the guards, but not the workflows that call them (`security.yml`, the CI workflow): GitHub usually refuses to merge a workflow change with the job token, which is not a guarantee. The checks stop a regression, not a deliberate edit by someone who can change what runs them.
- The API pins the head of a merge, not its base. The base is re-read right before the merge call; a pull request retargeted in the instant between the two would be merged into its new base, against which the gate did not judge it.
- A pull request of 300 files or more, or of more than 250 commits for a Dependabot one, cannot be listed completely from the immutable range: it is held for a hand merge.
- A Dependabot entry's `indirect` type is trusted from the commit text; it is not cross-checked against an open alert.
- Security updates are not subject to `cooldown` (GitHub documents it as a version-updates option): a fix version merges as soon as its CI is green.
- Without a post-merge dispatch, the default branch is tested before the merge only (§ After the merge).

## Checks

`scripts/guards.d/40-auto-merge.sh`, run by the gate, locally and wherever CI runs it:

- **AM-1** — `CLAUDE_GATE_RE` gates a table of paths that must be held and lets a table of ordinary paths through; every job that merges applies it and refuses `claude/issue-*` heads.
- **AM-4** — the two "mark ready" lines are pinned to their exact text, and every merge call in the file, however spelled, is one of the gated ones.
- **AM-5** — the workflow's own `dependabot_verdict` and `bump_level` are extracted and run on the commit-body shapes that must merge and the ones that must hold; the author check, the exact `merge` verdict and `MAJOR_HOLD_RE` are pinned; `dependabot.yml` sets no `allow` and has no `.yaml` twin.
- **AM-6** — one workflow is waited for, the pull request is selected by its head SHA, every merge passes that SHA, and it comes from the triggering event.
- **AM-7** — the gate judges the range that is merged: no listing of the pull request's current files or commits, one read of `compare/<base commit>...<validated head>` per merging job, a head check before the file count is trusted, the base re-read right before each merge, and the base taken from the event or from the gate.

AM-1 also requires `CLAUDE_GATE_RE` to be defined exactly once, in the workflow-level `env`: a job- or step-level definition would shadow it.

AM-2 and AM-3 are unused: they belong to a post-merge dispatch (§ After the merge).

## History

- Installed with the kit.
- After a security review of the kit: the gate reads the immutable range instead of the pull request's live file and commit listings (AM-7); the gate runner, every guard and the plugin registry are held for a hand merge; `CLAUDE_GATE_RE` must be defined once.
