# Changelog

What changed in the kit, newest first. A release is a commit of `main` tagged `v<version>` (from 0.3.1 on, by `.github/workflows/release.yml`; earlier versions carry no tag); `kit.json` carries the same version, and a project's `.claude/harness.json` records the version and the commit it was installed from.

Entries are no longer written into this file directly. A pull request that changes the kit adds a fragment, `changes/<slug>.md` (the slug in lower case, digits and hyphens), and leaves this file and the version alone:

```markdown
bump: minor

- What changed, as the entry will read.

By hand: nothing.
```

The first line is the level, `patch`, `minor` or `major`. After a blank line come the lines of the entry, then, last, a paragraph that starts with `By hand:` and says on the same line what an installed project does beyond `update`: `By hand: nothing.` when there is nothing, which may go on with a remark. No other line starts with "By hand", and a fragment has no heading. It speaks of its own change only, never of the release as a whole: it lands in one entry beside the others. `node bin/release.mjs` cuts a release, in a pull request of its own: the highest level among the fragments gives the next version, written to `kit.json` and `package.json`; the entry goes on top of this file, with the fragments' lines (the highest level first) and one "By hand" part, which holds the steps of the fragments that have one, then the remarks of the others; the fragments are removed, and `node bin/harness.mjs update .` records the version in the kit's own installation. The entries up to 0.8.0 were written directly.

Each entry says what an installed project has to do beyond `update`. Seeds are never rewritten: a change to a skeleton is listed under "By hand" for the projects that want it.

## 0.10.0

- `agents`: the Bash allowlist accepts a `cd` only as `cd ./<cwd> && <command>`, written exactly so and read before quotes are removed, and no longer reads `"$CLAUDE_PROJECT_DIR"/<path>` or an absolute path under the hook's root as the project's. Claude Code sets that variable for hooks, not for the Bash tool's shell, where `"$CLAUDE_PROJECT_DIR"/x` is `/x`: `cd "$CLAUDE_PROJECT_DIR"/lib && make test ; cat os-release` ran the configured command in `/lib` and read a file there, and `cat "$CLAUDE_PROJECT_DIR"/etc/passwd` read outside the project. A bare `cd <cwd>` follows `CDPATH` first; `./` does not. In a worktree session the hook's root can be another checkout than the worktree the session works in.
- A backslash that escapes the blanks ending a segment, or ends it, is refused: the guard dropped the escaped blank while the shell kept it (`cd ./backend\ ` is `cd './backend '`). So is a NUL, which the guard read inside an escape and a shell that drops it would not: latent only, since a command with a NUL cannot reach the Bash tool's shell.
- The verifier's brief, the convention page, the configuration seed's comment and the specification say the new forms: `cd ./<cwd> && <argv>`, `./scripts/security-checks.sh --offline`, paths relative to the root. The forms that go from allowed to refused have their rows: a bare `cd <cwd>`; a path through `"$CLAUDE_PROJECT_DIR"` (the gate as the command, after a `cd`, or as a reader's argument); an absolute path under the hook's root; a segment that ends in a backslash or an escaped blank; a NUL, inside an escape or in a pattern. The other new rows of the block tables pin nearby forms that stay refused, among them each part of the `cd` match: both of its ends, the literal `./`, a directory the config names, the first segment only, `&&` after it.
- `parallel-sessions`: the report compares the branches pushed to the remote that no worktree here holds — a session on another machine or in the cloud, or a branch nobody works on now — as it compares the branches of the other worktrees: their distance, the files in common, the merge forecast. The most recent come first, ten in full, the older ones counted; those with nothing left to merge are named. It fetches every branch of the remote and forgets those deleted there (`--prune`); `--no-fetch` keeps the last fetched state. Sessions in the cloud had worked side by side on one repository without the report seeing any of them.
- `parallel-sessions`: the skill and the page say when a session writes to the others unasked — before it changes a file with one writer at a time, when it opens its pull request, when its work ends —, what it sends, and what the recipient answers. Sessions in the cloud are reached with Claude Code Remote's `send_message`; `SendMessage` does not reach them.
- `ready-on-green`: a draft pull request labelled `session-active` keeps its draft whatever CI says. A session still at work on its pull request — a review running, a commit to come — says so with the label, then removes it and lifts the draft itself when its work is done. RG-4 checks that the label is read and acted on before the pull request is named to the step that lifts the draft; that step is tested on a table of pull requests. Not run live.
- `weekly-digest`: a pull request labelled `session-active` — the label a session puts on a pull request it is still at work on — is the session's, not the owner's. The digest leaves it out while something moves on it, and lists it once nothing has for 48 hours, the label being likely left behind: remove it, then lift the draft, if it is one, once CI is green on it.
- `auto-merge`: both merging jobs list what a pull request brings from the base branch's tip, read by its full ref right before listing, instead of from the pull request's `base.sha`, which GitHub does not move when the branch moves. A squash applies the head's changes since its merge base with the current tip: when a branch the head had merged landed on the base branch afterwards, a squash that set a held path back was not in the listing and merged unattended. Reproduced with the workflow's own steps against a local stand-in for the API, never seen on GitHub: from `base.sha`, squashes that set `.claude/settings.json` back, restored a removed hook or set a convention page back merged; from the tip all three are held.
- `auto-merge`: a listing of 300 files, the most the compare returns, holds whatever the pull request's file count: that count can come from another merge base than the tip's, so equal counts do not prove a whole listing.
- `auto-merge`: AM-7 checks one compare call per merging job, on a pinned line that lists from the tip; the tip read by `git/ref/heads/<branch>` after a check of the branch's name, and named on its read, its check and the listing only; the rows and their count on pinned lines; a failed read of the tip failing the job; no `base.sha`, `base_sha` or `BASE_SHA` in the jobs; the hold at 300 files, which only reports and exits. Its counts read the jobs only, so a project pattern set with `--set` may name anything. The policy page names three cases the tip does not close: a branch landing between the gate's read and the merge call, a head and a tip with two merge bases, and a branch that lands between the review and the gate.
- `claude-review`: the review reads its diff from the default branch's tip when it starts, so that it reviews what a merge would bring then. `CLAUDE_REVIEW_DIGEST` follows.
- `ready-on-green`: the page says when the `session-active` label comes off, and how a CI workflow can hold its jobs while it is on. The session removes the label once its work is done. With CI that runs in full on every push, the session lifts the draft itself only when CI has already ended green on the head, and otherwise leaves that to the workflow. With a CI workflow that holds its jobs — every job skipped while a draft carries the label, a run when the label comes off or a held draft is lifted —, removing the label runs CI once, in full, and the workflow lifts the draft. The page has the lines to copy, and why every job must carry them: a held run must end `skipped`, never `success` on checks that never ran. A label left behind keeps the pull request a draft, the safe side, until someone removes it.

By hand: in `.claude/hooks/agent-bash-guard.config.json`, a seed, the `$comment` may still say `cd <cwd> && <argv>`: change it to `cd ./<cwd> && <argv>`. An instruction of the project (an agent, a skill, a rule) that tells a sub-agent to write `cd <cwd> && <argv>` now says `cd ./<cwd> && <argv>`, and one that tells it to write `"$CLAUDE_PROJECT_DIR"/…` in a Bash command writes a path relative to the root instead.

To use it, create the label once: `gh label create session-active`.

To have CI hold its jobs while a session works, copy the lines of the page (§ A CI workflow that holds its jobs) into the CI workflow, onto every job.

## 0.9.0

- `eco-design` audits every pull request in CI. `eco-design.yml` fetches green-claude at the commit pinned in a new seed, `scripts/eco-design.config.json`, and `scripts/eco-design-audit.mjs` runs its audit on the files the pull request changes, as they were and as they are: a finding the pull request adds becomes an annotation and a row of the job summary, one the file already had does not. A manual run lists every finding of the branch. Advisory until the project sets `fail_on`; red when the audit could not run. The guard ED-1..3 pins the configuration, runs the script's tests and keeps the workflow at `contents: read` with no secret.
- green-claude's detector of broken local links builds a shell command from the links of the audited file. The audit runs from a copy without it, or any awk detector that can run a command, and names the rule left out.
- The module no longer requires `security-review`: the plugin in sessions is a separate decision, and its page says not to wire the plugin's hooks as they stand.
- The kit's own repository installs it.
- `auto-merge`: `CLAUDE_GATE_RE` holds `scripts/eco-design-audit.mjs`, its test and `scripts/eco-design.config.json`, which names the commit of the code the workflow fetches and runs; AM-1 has a row for each and neighbours that keep merging, and the weekly digest's built-in copy of the pattern follows.
- New module `headroom`, on demand: how to run the Headroom context-compression proxy on one machine without committing anything that routes sessions through it — a pinned install, a personal launch script that starts it from a clean environment with its egress switches, and why its own installers are left out. A `CLAUDE.md` bullet tells sessions not to install or start it unasked, nor to use those installers. Its guard (HR-1..3) reads what is committed (the index, not the disk): no file names Headroom or port 8787, Markdown prose aside; settings files, workflows and composite actions set no base URL, custom header or proxy variable (any host); symlinks and submodules are refused at the paths Claude Code and CI read; Headroom's local state and `headroom learn` blocks stay out of git. The word "headroom" in code, or port 8787 for another server, makes it fail: the page says which projects should not take it. Never run live; reviewed adversarially four times.
- `harness-init`, `harness-update`, `harness-adopt`: a post-install or "By hand" step that acts on a person's machine rather than on the project (installing a tool, starting a process, writing under `~`) is relayed, never done by the session.
- `agents`: the Bash allowlist of the read-only agents refuses whitespace other than a space, a tab or a newline anywhere in a command, quoted or not. Its tokenizer split words on what JavaScript calls whitespace — a carriage return, a vertical tab, a form feed, a no-break space and a dozen other Unicode spaces — and trimmed it from the ends of a segment, where the shell separates words on a space or a tab only. After an accepted environment prefix, that let any program run: the guard checked `LC_ALL=C<VT>cat rm README.md` as a `cat` of two files, the shell read one assignment word and ran `rm README.md` (also seen through a live Bash tool, with U+3000). Present since the first version; the specification has rows for each character, the blocked forms and the tab that stays allowed.
- The specification's sample verification command is `make check`, where it was `openspec validate`, which the `openspec` page now says never to list.
- `core`: a self-test that a guard runs with `node --test` (AG-1, PL-1, NA-2, WD-1, and any guard of the project's) fails the gate again when the gate is started from inside a Node test run, such as a project's own tests that call it to watch a guard go red. Such a run sets `NODE_TEST_CONTEXT` for what it starts, and from Node 20.12 a `node --test` that inherits it exits 0 whatever its tests do. `scripts/security-checks.sh` now clears it for every guard, and `scripts/guards.d/_lib.sh` again for a guard started on its own.
- The same variable is how Node stops a test run that starts itself again. Without it, a guard that runs tests which start the gate would loop: the gate now refuses to run more than three levels deep (`HARNESS_GATE_DEPTH`).
- The kit's end-to-end tests start the gate with the variable set, so a red self-test is seen red there whatever runs them, with a guard that sources `_lib.sh` and one that does not.
- `auto-merge`: `CLAUDE_GATE_RE` also holds the scripts that the guards of `weekly-digest`, `node-audit` and `parallel-sessions` run, and what they read: `scripts/weekly-digest.mjs`, its test and its settings (`scripts/weekly-digest.config.mjs`), which the scheduled digest also runs with a token that writes issues; `scripts/audit-gate.mjs`, its test and `scripts/audit-allowlist.json`, the accepted advisories; `scripts/parallel-sessions.sh`. The digest and audit files merged on green CI, judged by a CI that ran the changed file — for the allowlist, a derogation added with nobody reading it; the report merged unread and then ran on every contributor's machine.
- The same gap in three files that decide a verdict: a `.gitleaks.json`, which gitleaks reads before `.gitleaks.toml` (a pull request that added an allow-all one silenced the scan judging it), a workspace `.npmrc` (`omit=peer`, or a registry that answers nothing, emptied the audit) and a `zizmor.yml` at the root, which zizmor reads once `.github/zizmor.yml` is gone. They are held too. `security.yml` and the `pre-commit` hook name `--config .gitleaks.toml`, so gitleaks reads no other file and fails without it; the audit gate names peer dependencies, which a `.npmrc` can no longer omit.
- `REWORK_HOLD_RE`, the rework's copy of the list, and the weekly digest's built-in copy follow; AM-1 has a row for each path, and neighbours that keep merging. A test of the kit requires every file a module ships to be run or read to be held by both patterns, through `grep -i -E` as the workflows apply them, and every shipped script to have its AM-1 row; a file left out on purpose is named in the test with its reason.
- `openspec`: the page and the next steps state what the twelve files the CLI generates pre-approve. Their `allowed-tools: Bash(openspec:*)` lets a session run any `openspec` subcommand without a prompt during the turn that invokes one of them, whether you typed it or Claude invoked it, in a folder whose trust prompt was never accepted too — `feedback` (an issue on the tool's public tracker, through `gh`), `config`, `completion install`, `init` and `update` included — and a deny rule for one subcommand is passed by a global option placed before it. The kit does not narrow it: a project takes the module knowing it. The CLI's side was read in its 1.10.0 package, Claude Code's in its documentation; neither was observed in a session.
- `openspec`: the next steps and the page no longer tell a project with the `agents` module to add `openspec validate` to the verifier's config. At 1.10.0 the bare command sends a usage event to the CLI's telemetry unless `OPENSPEC_TELEMETRY=0` or `DO_NOT_TRACK=1` is set, `CI` holds a true value, or the CLI's global configuration turns telemetry off; that config must list nothing that reaches the network, and the Bash guard's environment prefixes include neither switch. The verifier validates by running the gate, where OS-1 sets `OPENSPEC_TELEMETRY=0`. The page now says when the CLI reaches the network and what its usage event carries, a random identifier that links a machine's events included.
- Status lines that understated what has run, corrected from the runs' logs. `weekly-digest` ran once live on the kit's own repository: the scheduled trigger, the reads, the labels and the issue with its assignment worked; its other sections, the closing of a previous digest and whether the assignment notified were not seen. `ready-on-green` was refused twice — the second time on the commit adding `contents: write`, which a `workflow_run` workflow only uses once it is on the default branch — then lifted the drafts of several pull requests.
- The pages had not followed the runs they record elsewhere: `auto-merge`'s Status now names its second live run, with `TEST_HOLD_RE` set, in which the gate held a reworded test line; `claude-review`'s names the same run, in which the review passed that pull request and held the removal of an assertion. The next steps of `claude-review` and `claude-rework` said "never run live", and the `/retro` part of the gate's page said so of a closing form that has run. Each page, `README.md` and the modules' next steps now say what was seen, and nothing more.

By hand:

- for a project that installed `eco-design` at 0.8.0, `update` brings the workflow, the script and its test, the guard, the page and the new configuration seed. Replace the **Eco-design** bullet of `CLAUDE.md` and the `eco-design.md` row of `docs/conventions/README.md` with the module's fragments (`fragments/CLAUDE.md/conventions.frag`, `fragments/docs/conventions/README.md/conventions-index.frag`), then do the live check of `docs/conventions/eco-design.md` on the first pull request.
- a project that deleted its `.gitleaks.toml` restores it, since the secret scan in CI and the pre-commit hook now fail without it (`show . .gitleaks.toml --modules core` prints the kit's skeleton). A project that had added some of these paths to its own `PROJECT_GATE_RE` may take them out again (`update . --set PROJECT_GATE_RE=<the rest>`); a path both patterns match is held all the same.
- a project that followed the old step removes the `openspec validate` entry from `.claude/hooks/agent-bash-guard.config.json`; the verifier validates through `scripts/security-checks.sh --offline`.

If you keep copies of the kit's skills in `~/.claude/skills/`, copy them again. Taking the module (`add . --modules headroom`) only adds files to the project; setting Headroom up on a machine is a person's step, described on `docs/conventions/headroom.md`.

## 0.8.1

- How the kit itself is released; no module changes with it. A pull request no longer writes the version or its `CHANGELOG.md` entry: it adds a fragment, `changes/<slug>.md`, with its level (`patch`, `minor` or `major`), the lines of its entry and its "By hand" part, so that pull requests written in parallel stop conflicting on the same lines. The format is at the top of `CHANGELOG.md`.
- `node bin/release.mjs` cuts a release, in a pull request of its own: the highest level among the fragments gives the next version, written to `kit.json` and `package.json`; the entry goes on top of `CHANGELOG.md` with one "By hand" part; the fragments are removed and `update .` records the version in the kit's own installation. `--dry-run` writes nothing. `.github/workflows/release.yml` still tags the merge.
- The tests check every fragment, and the kit's CI fails a pull request that changes `modules/`, `lib/` or `bin/` without adding one. A change to `CHANGELOG.md` or `changes/` now starts that CI.

By hand: nothing.

## 0.8.0

- New module `eco-design`, on demand: the convention for using the `green-claude` plugin (eco-design rules drawn from RGESN and GR491, with a deterministic audit) at a commit the project has read, through the plugin pins of `security-review` (PL-1). It states what the plugin changes in a session, puts its rules below `CLAUDE.md`, security and the request, treats an audit hit as a candidate to confirm in context, and makes `.green-claude/decisions.md` a reviewed derogation list. One bullet in `CLAUDE.md`, one convention page. Nothing is copied from the plugin, and nothing in it has run live.

By hand: nothing. To take the module: `add . --modules eco-design`, then read the plugin and record it in `scripts/reviewed-plugins.json` before installing it.

## 0.7.2

- `parallel-sessions`: a branch that is behind the default branch catches up before its pull request is opened, whatever the files concerned — a rebase while no commit of the branch is pushed, a merge once one is. The skill has that step, the report says which of the two applies, and PS-2 now notes any branch that is behind the default branch as last fetched, not only one whose files changed on both sides. Still a note, never a failure.
- The report's alarm reads `CATCH UP NOW` where it read `MERGE … NOW`.

By hand: nothing.

## 0.7.1

- `ready-on-green`: the job holds `contents: write` beside `pull-requests: write`. Its first live run found the pull request and was refused the call with the one permission. A wider token on a `workflow_run` job: the guard RG-2 still refuses any call but `gh pr list`, `gh pr view` and `gh pr ready`.
- Statuses: `auto-merge` with `TEST_HOLD_RE` set by `--set`, the `harness-update` skill and the closing form of `/retro` have each run once live; their pages and `README.md` say what was seen.
- `update` no longer lists as a step an entry whose "By hand" part starts with "By hand: nothing." and goes on with a remark. Seen on the first live update across 0.5.0.

By hand: nothing.

## 0.7.0

- New module `parallel-sessions`, for a repository several sessions work in at once, each in its worktree. `scripts/parallel-sessions.sh` reports how far a branch is behind the default branch, which files it shares with the branches of the other worktrees and whether merging two of them would conflict; it reads refs only, so it sees commits, never uncommitted work. A skill of the same name carries the procedure: syncing, the order of merges, telling another session. The guard keeps session worktrees out of git (PS-1) and notes a base that went stale on the branch's files (PS-2, never a failure). A commented `.worktreeinclude` seed comes with it.
- The module adds no bullet to `CLAUDE.md`: its skill and PS-2 carry the rule, and its page holds the line for a project that wants one.
- The kit's own repository installs it.

By hand: nothing. To take the module: `add . --modules parallel-sessions`.

## 0.6.0

`CLAUDE.md` costs less, and its budget measures what a session loads.

- **CM-1 counts what is loaded**: `CLAUDE.md` without its block-level HTML comments (Claude Code strips them before injection), plus every `.claude/rules/**.md` that has no `paths:` list. Until now it counted the raw file. The guard prints the three numbers.
- **Path-scoped rules**: the GitHub Actions and Dependabot rules (`ci-security`), the session-settings rule and the OpenSpec file layout are now files under `.claude/rules/` with a `paths:` list, loaded when a session touches the files they name, instead of bullets of `CLAUDE.md`. The contract has a section for them, and a test.
- **A bullet is at most 400 bytes** (it was 700, and "five lines" in the pages). The bullets of `node-audit`, `weekly-digest`, `claude-ci` and `openspec` are shorter.
- `.gitignore`: a second block, `claude-template:rules`, re-includes `.claude/rules/`.

By hand, in a project installed before this version: `update` brings the rule files and the `.gitignore` block, but the bullets it inserted in `CLAUDE.md` stay, since the file is yours. Delete the **GitHub Actions**, **Dependabot** and **Session settings** bullets under "Key conventions" (their text is now in `.claude/rules/`), and take the shorter **OpenSpec**, **npm audit gate**, **Weekly digest** and **Claude in CI** bullets from the modules' `fragments/CLAUDE.md/conventions.frag` if you want the bytes back. Then check once, in a live session, that opening a workflow loads the rule (`docs/conventions/claude-md.md` § Limits).

## 0.5.0

- New module `ready-on-green`: a workflow that marks a draft pull request ready for review once its CI run is green, and does nothing else — no checkout, no action, no merge, one permission. For a repository that opens pull requests as drafts and does not install `auto-merge`, which already lifts the draft. Its guard (RG-1..3) pins the trigger, the permission and the conditions. Installed on the kit's own repository.

By hand: nothing. To take the module: `add . --modules ready-on-green`, not alongside `auto-merge`.

## 0.4.1

Installer only; no module changed.

- `update` ends its report with the "By hand" steps of every version between the one the project records and the kit's, read from this file. They are listed again until the manifest names the new version, and never count as "behind" for `--check`. A test requires such a part in every entry.
- A reader that closes early (`status . | head`) no longer ends in a Node stack trace: the report stops, the files are still written and the exit code is the command's.

By hand: nothing.

## 0.4.0

- `core`: the `/retro` skill gets a closing form, run by the session at its end, and a new first destination — what concerns a kit-owned file or the installer becomes a drafted issue for the kit's repository, written in general terms and posted only on the user's yes. The skill is no longer `disable-model-invocation`.
- `core`: new placeholder `KIT_REPOSITORY` (owner/name), whose default is the `repository` of `kit.json`. A fork names its own there, or a project with `update . --set KIT_REPOSITORY=<owner>/<name>`.
- `core`: the `CLAUDE.md` skeleton has a working rule that closes a session with `/retro`.

By hand, for an installed project — `CLAUDE.md` is a seed and does not follow the kit: add under "Working rules" the bullet "End a session that changed files with `/retro`." The skeleton keeps it that short on purpose: with every module installed it must leave the project 40% of the budget, and the skill's own description says when to run it. Two other working rules were shortened to pay for it, without changing what they ask.

## 0.3.1

No module changed.

- Two skills beside `harness-init`, to copy into `~/.claude/skills/`: `harness-adopt` (bring a repository that already has its own harness under the kit, module by module, deciding each file) and `harness-update` (check, update a selection, merge, leave the real conflicts to the user).
- The kit's own repository tags `v<version>` by a workflow when `kit.json` changes on `main`.

By hand: nothing.

## 0.3.0

- `update --merge`: a kit file edited in the project and changed in the kit is merged when the two sets of changes do not overlap. The version that was installed is looked up in the kit's git history and recognised by the hash the manifest recorded, so it needs git and the kit as a checkout with its history. An overlap, or no history, leaves the file a conflict; no conflict marker is ever written. A merged file is still listed as edited in the project.
- `update --set KEY=VALUE` changes a placeholder value: the files that carry it are rendered again and the value is recorded.
- `auto-merge`: `PROJECT_GATE_RE`, `TEST_HOLD_RE` and `MAJOR_HOLD_RE` are values of the installation, set with `update --set`, instead of lines to edit in `auto-merge.yml`. As shipped the rendered workflow differs from the previous one in comments only. A test now keeps `TODO(harness)` markers out of every kit-owned file that is not a page.
- `adopt` prints a count per module (created, identical, adopted, seeds kept, conflicts), and `adopt --decline-fragments` records the sections a file without slots will not take, so that they are not proposed again.

By hand, for a project that set those three patterns by editing `.github/workflows/auto-merge.yml`: pass them once as values, then take the kit's file — `update . --set PROJECT_GATE_RE=<yours> --set TEST_HOLD_RE=<yours> --set MAJOR_HOLD_RE=<yours> --only .github/workflows/auto-merge.yml --force`, after checking with `show . .github/workflows/auto-merge.yml | diff - .github/workflows/auto-merge.yml` that nothing else of yours is in the file. A project that extended `CLAUDE_GATE_RE` itself moves its additions to `PROJECT_GATE_RE` first.

## 0.2.0

Installer only; no module changed.

- `update --modules a,b` and `update --only <path>` refresh a selection: the files of some installed modules, one file, or a directory. What is left out stays recorded as installed and is listed as "not selected — still behind the kit"; the manifest names the new kit version once every file follows it.
- `update --check` writes nothing and exits 3 when the project (or the selection) is behind the kit: something to create, refresh, insert or remove, or a conflict.
- `update` removes a file the kit no longer ships when it is still identical to the hash recorded at installation. An edited one, or a seed, is reported and left. `init` and `add` never delete.
- `adopt` installs into a repository that already has its own version of some kit files: such a file is kept and recorded as a kit file edited in the project, with the hash of the kit's version, where `init` leaves an unrecorded conflict. `show <dir> <file>` prints the kit's version of a file, to compare.
- `.claude/harness.json` records `kit.commit` when the kit is a git checkout (`-dirty` appended when it has uncommitted changes). `status` and the reports print it.

By hand: nothing.

## 0.1.0

The first version: the installer (`list`, `init`, `add`, `status`, `update`) and the modules listed in `README.md`.

By hand: nothing.
