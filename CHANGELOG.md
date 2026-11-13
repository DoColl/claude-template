# Changelog

What changed in the kit, newest first. A release is a commit of `main` tagged `v<version>` (from 0.3.1 on, by `.github/workflows/release.yml`; earlier versions carry no tag); `kit.json` carries the same version, and a project's `.claude/harness.json` records the version and the commit it was installed from.

Each entry says what an installed project has to do beyond `update`. Seeds are never rewritten: a change to a skeleton is listed under "By hand" for the projects that want it.

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
