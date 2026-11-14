# Weekly digest — what the harness is waiting on a human for

**Rule (CLAUDE.md § Key conventions):** `weekly-digest.yml` opens one `weekly-digest` issue a week, assigned to the repository owner, listing what waits on a human. Every workflow with a `schedule:` is watched automatically; the digest copies titles only, never bodies; a dated follow-up is an issue labelled `deadline` with a `Due: YYYY-MM-DD` line, never a Markdown list.

Files: `.github/workflows/weekly-digest.yml`, `scripts/weekly-digest.mjs`, and the project's settings in `scripts/weekly-digest.config.mjs`.

## Status

**The logic is unit-tested; the workflow has run live once, on the kit's own repository.** `scripts/weekly-digest.test.mjs` (WD-1) covers what is listed and why, on fixtures, with no network. On 2026-11-13 the scheduled trigger fired on its day, nearly eight hours after the time its cron names; with the permissions the workflow grants, the job read the repository, made its labels and opened the digest as an issue labelled `weekly-digest` and assigned to the owner. That digest had one section, the scheduled runs, with one item: `security.yml` had no scheduled run yet — installed two days earlier, its weekly cron had not come round, and the digest does not know how old a workflow is. Not seen: whether the assignment notified the owner. Not exercised: the pull-request, alert and deadline sections (no pull request was open, no alert or deadline issue existed), closing a previous digest (it was the first), "nothing waiting", the manual dry run. So the first thing to do after installing it is still one manual run: once the workflow is on the default branch, **Actions → Weekly digest → Run workflow, with `dry_run` ticked**, then read the run summary. It prints the digest and writes nothing. Trust the schedule only after that.

## Why

A harness blocks and detects on its own, but several of its outcomes only **wait** for a human. Some by design: pull requests that must be merged by hand (Claude instruction files, dependency majors and other bumps a merge gate holds, workflow changes an automated merge is not allowed to push). Others because a signal went unanswered: an alert issue nobody triaged, a scheduled run that failed or never fired, a follow-up past its date. Each sits in its own corner of the repository and nothing surfaces it; they are found the day someone asks where things stand, by which time several have waited for days.

The digest does not remove a single human gate. It gathers them into one weekly rendezvous.

## Details

### What it lists

Once a week (cron `41 5 * * 5`, Friday morning UTC unless you change it — nominal, GitHub crons fire late) and on `workflow_dispatch`:

| Section | Listed when |
|---|---|
| Pull requests | conflict with the default branch (mergeability is re-read while GitHub still says `unknown`); **no CI run** on the head commit after 1 h, unless every path is in the docs-only set and none is a path CI runs on all the same (both sides of a rename count, a truncated file listing never qualifies); CI red; green but still open after 48 h, with the reason it did not merge (Claude instruction files, a Dependabot major or a bump the merge gate holds, a workflow change, unknown) |
| Scheduled runs | the latest CI run of the default branch itself is not green (pull-request runs from a fork branch of the same name are ignored); a scheduled workflow's last scheduled run failed, or is older than its slack, or does not exist |
| Dependabot alerts | an open issue labelled `dependabot-alert` that has been open for 7 days or more |
| Deadlines | an open issue labelled `deadline` whose body has a `Due: YYYY-MM-DD` line that is past (the day itself is not overdue) or within 7 days, or that has the label and no such line |

Output: one issue labelled `weekly-digest`, **assigned to the repository owner** — the assignment is what makes GitHub notify; an owner that cannot be assigned (an organisation, a renamed login) gets the issue unassigned, with a warning in the run. Its title carries the count. The previous open digest is commented "Superseded by #N" and closed. With nothing to report, no issue is opened and the previous one is closed. The digest never comments on a pull request, never merges, never dispatches anything.

### Rules

- **Every workflow with a `schedule:` is watched**, with no registration: the script discovers them at run time (block, flow and quoted spellings). The slack is 9 days, sized for a weekly cron that fires late; a workflow that runs more often gets an entry in `maxAgeDays` (settings file), which must name a workflow that really has a schedule.
- **The digest cannot report on itself.** If it stops running, nothing is posted, and "nothing waits" looks the same from the issue list. When no digest shows up for a while, check that the workflow ran on its scheduled day.
- **Dated follow-ups are issues**, labelled `deadline`, with a `Due: YYYY-MM-DD` line in the body — not a list in a Markdown file. A list in a review document drifts silently; an issue with a date ends up in the digest.
- **External text goes through `safeText`.** Titles of pull requests and issues are written by whoever opened them: `@` is broken with a zero-width space so the digest never mentions anyone (a title such as "bump @types/node" would), line breaks are joined, the length is capped.
- **Titles only, never bodies.** The body of a pull request or of an alert is third-party text (an advisory summary, the description of a pull request from a fork). Copying it into the digest would carry it into an issue that other automation may read. `deadline` bodies are read for the date and nothing else. If a CI agent answers mentions on issues in this repository, it must refuse `weekly-digest` issues before the repository accepts pull requests from forks: their titles land there.
- **The job token only.** `contents`, `pull-requests` and `actions` read, `issues` write. Dependabot alerts are read through their issues, so no personal access token is needed.

### Settings

`scripts/weekly-digest.config.mjs` belongs to the project (the kit never overwrites it) and is checked when the script loads:

- `defaultBranch` — the branch pull requests are merged into.
- `ciWorkflow` — the `name:` of the CI workflow a pull request waits for. The digest finds the workflow file carrying that name. If none does, no CI run is expected anywhere: pull requests are listed on conflicts and age only, and the digest says so in its footer.
- `maxAgeDays` — the per-workflow slack described above.
- `ciAlsoRunsOn` — optional. The documentation paths the CI workflow runs on all the same (`'.claude/**'`, `'**/CLAUDE.md'`), written with ASCII letters and digits, `_ . - @ /`, `*` and `**` only: a `?`, `[…]` or `{…}` pattern becomes the paths it covers, any other character (a space) a `*`. Unset, the digest reads them from the CI workflow (below); set it when WD-1 says the trigger cannot be read. An empty list means none.

The thresholds (48 h, 7 days, 9 days) are constants at the top of `scripts/weekly-digest.mjs`.

### With and without the auto-merge workflow

When `.github/workflows/auto-merge.yml` exists, the digest reads two declarations from it instead of keeping its own copy, so the digest and the merge gate cannot drift: the `CLAUDE_GATE_RE` entry of the workflow-level `env:`, joined with the project's `PROJECT_GATE_RE` when the workflow has one (the paths that are never merged unattended), and the pattern of the `NON_DOCS=$(grep -E -v -c '…'` line (the docs-only set). If either declaration disappears or is renamed, WD-1 fails. It also reads `TEST_HOLD_RE` when the workflow has one and it is filled: a green pull request left open that touches those paths is listed as possibly held for its tests — the digest knows paths, not which lines went, so the line sends to the workflow run.

When that workflow is not installed, the digest falls back to built-in values (`DEFAULT_GATE_RE` and `DEFAULT_DOCS_RE` in the script): any `.claude/` directory, `CLAUDE.md`, `CLAUDE.local.md` and `AGENTS.md`, `.githooks/`, a project `.mcp.json` or `.claude.json`, `.ripgreprc`, `.gitmodules`, `.husky/`, the `auto-merge` and `claude*` workflows, the gate and what it runs or reads (`scripts/security-checks.sh`, `scripts/guards.d/`, every other file the kit ships under `scripts/` — its scripts, their tests, the settings and lists they read —, any `.npmrc`, `.gitleaks.toml`, `.gitleaks.json`, `.gitleaksignore`, `.github/zizmor.yml` and a root `zizmor.yml`), the findings catalogue at the root (`SECURITY_REVIEW*.md`) and the convention pages (`docs/conventions/`) for the first — the same list as the `CLAUDE_GATE_RE` the auto-merge module ships; Markdown files, `docs/`, `LICENSE` and `.gitignore` for the second. Nothing merges on its own in that setup, so a green pull request still open after 48 h is simply reported as waiting for a merge, and no reason points at a workflow that is not there.

The docs-only set is what tells "no CI run is expected" from "the run is missing". It must match what your CI workflow skips. If your CI runs on every pull request, the set never comes into play.

### Documentation paths CI still runs on

A CI workflow that skips Markdown also skips `CLAUDE.md` and the agent definitions, unless it takes them back: the gate has checks made for those files, and the kit's CI skeleton re-includes them in its `pull_request` trigger. The docs-only set still counts them as documentation — with `auto-merge.yml`, because that workflow holds them for a hand merge rather than sending them through CI; without it, because the built-in set takes every Markdown file — so on its own it would tell the digest that no run is expected on a pull request touching only `CLAUDE.md`. If its run then never started, the digest would list the pull request as "merge by hand", and the one fact worth a line, the missing run, would be lost.

So the digest also reads the CI workflow, found by the name in `ciWorkflow`: in its `pull_request` trigger, the `paths` entries that follow the last `!` exclusion are the paths taken back. A pull request touching one of them is expected to have a run, whatever the docs-only set says. Read are a block list or a one-line `[…]` list, either line ending, with patterns made of ASCII letters and digits, `_ . - @ /`, `*` and `**`. What falls outside fails WD-1 with a pointer to `ciAlsoRunsOn`, rather than being ignored: another pattern character, a `paths` value written another way (a list over several lines, an alias), a `pull_request` written as a flow mapping, and a path taken back before a later exclusion — GitHub weighs each path against the entries in order and the last match decides, so a later `!` that does not match the path leaves it taken back, while "after the last exclusion" would drop it. A trigger that takes nothing back — no exclusion, `paths-ignore`, no `paths` at all — changes nothing.

### What feeds the alerts section

GitHub does not open issues for Dependabot alerts. The section lists issues labelled `dependabot-alert`, which a separate workflow has to create by mirroring the alerts (it needs a credential allowed to read them). The kit does not ship that workflow: without one, the section stays empty and costs nothing.

## Checks

- **WD-1** — `node --test scripts/weekly-digest.test.mjs`, run by `scripts/guards.d/42-weekly-digest.sh` and therefore by the gate and CI. The digest workflow does not run it: a red WD-1 must never silence a digest.

## History

- Installed with the kit.
- After a review of an installed project: a pull request touching only instruction files, on a project whose CI runs on them, would have been listed as a hand merge when its CI run had never started. The digest now reads which documentation paths the CI workflow takes back, or the `ciAlsoRunsOn` setting; a trigger it cannot read turns WD-1 red and only warns in a scheduled run. Unit-tested, and tried in rendered projects with the GitHub API stubbed; like the rest of the digest, not run live.
- First live run, on the kit's own repository (§ Status): the scheduled trigger, the reads, the labels and the issue worked; nothing in the digest changed.
