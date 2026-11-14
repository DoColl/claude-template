# Eco-design

**Rule (CLAUDE.md § Key conventions):** every pull request is audited by `eco-design.yml` against the green-claude rules, at the commit pinned in `scripts/eco-design.config.json`. A finding is a candidate: fix it, or record a decision in `.green-claude/decisions.md` with its reason, reviewed like a derogation. The rules never outrank `CLAUDE.md`, security or what was asked.

## Status

- `scripts/eco-design-audit.mjs` is unit-tested (ED-2), against a stand-in written in the output format of green-claude's audit: which files are audited, what a change is charged with, the detectors left out, the report and the exit code.
- The workflow **ran live** on the kit's own repository, on the pull request that added it. Its first run stopped in the script, on the shape of the real rule catalogues; fixed, and the tests' stand-in now has that shape. Its second run fetched green-claude at the pinned commit, audited the 8 changed files of covered kinds, reported 12 new findings — 10 as annotations, all 12 in the log — named ECO-HEB-06 as not audited, and stayed green with `fail_on: none`. None of the 12 held in context (a nested iteration over a few small catalogues, a command-line tool's own output, small files read whole, an `exit` inside a string taken for dead code): candidates, as this page says. The log and the annotations were read; the job summary was not read back.
- Not exercised: the manual inventory, a blocking `fail_on` on a real finding, a decision that silences one, a required check holding a merge, a pull request from a fork.
- The reading, at the commit named under Sources: the audit script, its helpers, every detector and inspector, the skill file, the hook scripts, the plugin manifests and the licence files, in full. The rule catalogues were read as data: their patterns go to `grep`, their text to the report.

## Why

Code runs for years after the change that wrote it: a query in a loop, a payload without pagination, a library imported for one function. green-claude names those patterns, with the public reference behind each one (RGESN, GR491), and ships a deterministic audit that finds them.

As a skill, it applies when the model loads it: often, not always. As a check in CI, it applies to every pull request, whoever or whatever wrote it, and its result is on the pull request for the reviewer. The kit copies none of it: the workflow fetches the audit at a commit the project has read, so a new release of the rules is a one-line bump, after a reading.

## Details

### What runs

On every pull request, `eco-design.yml`:

1. checks out the merge commit and its first parent, the base, and keeps no credential;
2. fetches green-claude by commit from the repository named in `scripts/eco-design.config.json`, and checks that what it got is that commit;
3. runs `scripts/eco-design-audit.mjs`, which runs green-claude's `eco-audit.sh` on the files the pull request adds, modifies, copies or renames — those of a kind the rules cover: code, markup, stylesheets, YAML; not Markdown or JSON, as the plugin's own hooks do — once as the pull request leaves them and once as they were, and keeps what is new.

A manual run (`workflow_dispatch`) audits every tracked file of the branch instead: the inventory of the debt already there. It fails on nothing.

The job holds `contents: read` and no secret: the audit is third-party code running on files a pull request wrote.

### What counts as new

A rule that fires on a file after the change and did not fire on that file before it. A renamed file is compared with its old path; an added one has no before. A rule the file already broke is not charged to the change, even when the change adds a second occurrence: that debt shows in the inventory, not in every pull request that touches the file. The comparison under-reports on purpose: an audit that blames a change for what it did not do teaches people to skip it.

### What it reports

- An annotation per new finding, ten at most, on the file and, for the rules that have one, the line. Most rules match a pattern anywhere in the file and give no line.
- A job summary: the new findings, what each rule recommends, the rules not audited, the findings hidden by decisions, and a line when the pull request edits `.green-claude/`.
- The plain report in the log, printed with workflow commands off, so that no line of an audited file can become one.

The summary credits the rules' source, as their licence asks.

### Blocking

Advisory by default (`fail_on: none`): the check is green whatever the audit finds, and red only when the audit could not run — an audit that fails in silence reads like a clean one.

With `fail_on` set to `high`, `medium` or `low`, a new finding of that impact or above fails the check. A failing check holds a merge only once it is required: add `Eco-design audit` to the required checks of the default branch's ruleset.

Start advisory, read a few runs, record the decisions the team takes, then raise the level. The plugin's authors advise against an audit that blocks, because its findings are candidates; a level with reviewed decisions is the middle way.

### Decisions and exclusions

Two files of green-claude's own format, at the repository root, read by its audit:

- `.green-claude/decisions.md` — a line `ECO-CONT-01  docs/index.html  ACCEPTED  <reason>` silences one rule for one file; `TODO` in place of `ACCEPTED` keeps the finding visible. The rest of the file is free prose.
- `.green-claude/ignore` — one extended regular expression per line, matched against paths: what is out of scope (test fixtures, rule catalogues, generated code).

Both silence findings, so both are derogations: tracked, changed in a reviewed pull request, a reason on every line, accepted by a person. A session may propose a line; it does not add one on its own. The summary says when a pull request edits either file.

### The detector left out

At the commit read, one detector of green-claude, `detect-broken-links.awk` — rule ECO-HEB-06, a local link to a file that does not exist, in HTML, Vue, Svelte and stylesheets — tests each link with a shell command it builds from the link's text, inside double quotes. A link written `href="$(…)"` in an audited file therefore runs a command on the machine that audits. In CI on a pull request, that is code its author could run anyway: a pull request can change the workflow it triggers. On a developer's machine, or in a hook that audits what a session wrote, it is not.

`eco-design-audit.mjs` runs the audit from a copy of green-claude's scripts and rules without any awk detector that can run a command or open a file by name (`system()`, `getline`, a pipe or a redirection after `print`), and names the rules left unaudited in the summary. At the commit read, that is ECO-HEB-06 alone. The test is on the detector's code, not on its name: a detector added later with such a call is left out too. Symbolic links are not audited either: they could point outside the checkout.

### Bumping the pin

1. Read green-claude at the new commit: `skills/green-claude/scripts/` in full, and what changed in the rule catalogues.
2. Put the commit and the date in `scripts/eco-design.config.json`, in a pull request of its own: its run is the first at the new commit.
3. Run the workflow by hand on the default branch: a rule the new version adds fires on old code there, not in the next pull requests.

Never a branch or a tag: the workflow runs what the file names, and a branch would change what runs without anyone reading it. ED-1 refuses anything but a full commit.

### The plugin in sessions

The same rules exist as a Claude Code skill, `green-claude`, which applies them while a session writes code. Installing it is a separate decision. It is third-party code that loads in every session: read it at a commit and pin it, as any plugin. When it is installed, its rules never outrank `CLAUDE.md`, security or what was asked: state the trade-off in one sentence, then deliver.

Do not wire the plugin's optional hooks as they stand. Its audit hook runs green-claude's audit, detectors included, outside the Bash sandbox, on what a session has just written — content a prompt injection can choose. The CI audit covers what that hook would catch, without that exposure.

### Live check

On the first pull request that changes a file of a covered kind:

1. The `Eco-design audit` check ran. Its log names the commit fetched; with `fail_on: none` it is green.
2. Its summary lists the files audited and, for each new finding, the rule, the file and the recommendation.
3. In a scratch pull request, add `SELECT * FROM t;` to a `.sql` file: ECO-SQL-01 appears as an annotation on that file. Close the pull request.
4. Run the workflow by hand on the default branch: the inventory lists the debt already there, and the check stays green.

If one of these does not hold, this page is wrong for the version in use: correct it before relying on the check.

### Limits

- Most rules match a pattern somewhere in the file: a finding says where to look, not that there is a defect.
- New means new rule on the file, not new occurrence (§ What counts as new).
- A pull request with a merge conflict gets no run: GitHub builds no merge commit for it.
- The inventory runs every rule on every file: on a repository with thousands of files of covered kinds it can reach the job's 30-minute limit.
- The rules cover the web and the common back-end languages; a file in another language is not audited.
- The commit identifies what runs, on the repository named next to it. A commit of a fork of that repository may be reachable through it by the same identifier, as for actions pinned by commit: read the commit on the repository itself.

## Checks

`scripts/guards.d/49-eco-design.sh`:

- **ED-1** — `scripts/eco-design.config.json` names a repository (`owner/name`), a full 40-character commit and a `fail_on` among none, low, medium and high.
- **ED-2** — `node --test scripts/eco-design-audit.test.mjs` passes.
- **ED-3** — `.github/workflows/eco-design.yml` keeps `pull_request` and `workflow_dispatch` as its only triggers and `contents: read` as its one permission under `permissions: {}`, reads no secret, and its checkout keeps no credential.

Nothing checks that a finding was read, or who wrote a line of `.green-claude/decisions.md`: that is the review of the pull request.

## Sources

- [Institut-du-Numerique-Responsable/green-claude](https://github.com/Institut-du-Numerique-Responsable/green-claude) — Apache-2.0 for code, CC BY 4.0 for rules and documentation — read at `bc2a1cf` (2026-11-13). Nothing is copied: the workflow fetches its audit at the pinned commit and runs it, and the job summary shows the titles and recommendations of its rules, with the credit line their licence asks for. This page restates the format of its decisions and ignore files, and what its hooks and its broken-links detector do.

## History

- 0.8.0 — the convention for the plugin in sessions, pinned as a plugin.
- 0.9.0 — the audit runs in CI on every pull request; the plugin is no longer needed for it; the detector that runs a command is left out. First live run on the kit's own pull request.
