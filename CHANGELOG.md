# Changelog

What changed in the kit, newest first. A release is a commit of `main` tagged `v<version>`; `kit.json` carries the same version, and a project's `.claude/harness.json` records the version and the commit it was installed from.

Each entry says what an installed project has to do beyond `update`. Seeds are never rewritten: a change to a skeleton is listed under "By hand" for the projects that want it.

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
