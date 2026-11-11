# Weekly digest — what the harness is waiting on a human for

**Rule (CLAUDE.md § Key conventions):** `weekly-digest.yml` opens one `weekly-digest` issue a week, assigned to the repository owner, listing what waits on a human. Every workflow with a `schedule:` is watched automatically; the digest copies titles only, never bodies; a dated follow-up is an issue labelled `deadline` with a `Due: YYYY-MM-DD` line, never a Markdown list.

Files: `.github/workflows/weekly-digest.yml`, `scripts/weekly-digest.mjs`, and the project's settings in `scripts/weekly-digest.config.mjs`.

## Status

**The logic is unit-tested; the workflow has not run live.** `scripts/weekly-digest.test.mjs` (WD-1) covers what is listed and why, on fixtures, with no network. The GitHub side — the API calls, the labels, the assignment, the scheduled trigger — has not been exercised by the kit, nor yet by the project this digest was first written for. So the first thing to do after installing it is one manual run: once the workflow is on the default branch, **Actions → Weekly digest → Run workflow, with `dry_run` ticked**, then read the run summary. It prints the digest and writes nothing. Trust the schedule only after that.

## Why

A harness blocks and detects on its own, but several of its outcomes only **wait** for a human. Some by design: pull requests that must be merged by hand (Claude instruction files, dependency majors and other bumps a merge gate holds, workflow changes an automated merge is not allowed to push). Others because a signal went unanswered: an alert issue nobody triaged, a scheduled run that failed or never fired, a follow-up past its date. Each sits in its own corner of the repository and nothing surfaces it; they are found the day someone asks where things stand, by which time several have waited for days.

The digest does not remove a single human gate. It gathers them into one weekly rendezvous.

## Details

### What it lists

Once a week (cron `41 5 * * 5`, Friday morning UTC unless you change it — nominal, GitHub crons fire late) and on `workflow_dispatch`:

| Section | Listed when |
|---|---|
| Pull requests | conflict with the default branch (mergeability is re-read while GitHub still says `unknown`); **no CI run** on the head commit after 1 h, unless every path is in the docs-only set (both sides of a rename count, a truncated file listing never qualifies); CI red; green but still open after 48 h, with the reason it did not merge (Claude instruction files, a Dependabot major or a bump the merge gate holds, a workflow change, unknown) |
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

The thresholds (48 h, 7 days, 9 days) are constants at the top of `scripts/weekly-digest.mjs`.

### With and without the auto-merge workflow

When `.github/workflows/auto-merge.yml` exists, the digest reads two declarations from it instead of keeping its own copy, so the digest and the merge gate cannot drift: the `CLAUDE_GATE_RE` entry of the workflow-level `env:`, joined with the project's `PROJECT_GATE_RE` when the workflow has one (the paths that are never merged unattended), and the pattern of the `NON_DOCS=$(grep -E -v -c '…'` line (the docs-only set). If either declaration disappears or is renamed, WD-1 fails.

When that workflow is not installed, the digest falls back to built-in values (`DEFAULT_GATE_RE` and `DEFAULT_DOCS_RE` in the script): any `.claude/` directory, `CLAUDE.md`, `CLAUDE.local.md` and `AGENTS.md`, `.githooks/`, a project `.mcp.json` or `.claude.json`, `.ripgreprc`, `.gitmodules`, `.husky/`, the `auto-merge` and `claude*` workflows, the gate and what it runs or reads (`scripts/security-checks.sh`, `scripts/guards.d/`, the kit's helper scripts, `.gitleaks.toml`, `.gitleaksignore`, `.github/zizmor.yml`, `scripts/reviewed-plugins.json`) for the first — the same list as the `CLAUDE_GATE_RE` the auto-merge module ships; Markdown files, `docs/`, `LICENSE` and `.gitignore` for the second. Nothing merges on its own in that setup, so a green pull request still open after 48 h is simply reported as waiting for a merge, and no reason points at a workflow that is not there.

The docs-only set is what tells "no CI run is expected" from "the run is missing". It must match the `paths-ignore` of your CI workflow. If your CI runs on every pull request, the set never comes into play.

### What feeds the alerts section

GitHub does not open issues for Dependabot alerts. The section lists issues labelled `dependabot-alert`, which a separate workflow has to create by mirroring the alerts (it needs a credential allowed to read them). The kit does not ship that workflow: without one, the section stays empty and costs nothing.

## Checks

- **WD-1** — `node --test scripts/weekly-digest.test.mjs`, run by `scripts/guards.d/42-weekly-digest.sh` and therefore by the gate and CI. The digest workflow does not run it: a red WD-1 must never silence a digest.

## History

- Installed with the kit.
