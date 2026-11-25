bump: minor

- `update` run from a kit checkout that is ahead of its last release now says so. When changelog fragments wait in the kit's `changes/`, its report, `--dry-run` and `--check` included, ends with an "UNRELEASED" part: the fragments, their "By hand" steps, which no `CHANGELOG.md` entry carries yet, and the commit the files came from. The manifest still records the last release's version beside that commit, and `--check` does not count the part as behind. A fragment that does not parse is named and stops nothing. The kit updating its own root prints nothing more. `skills/harness-update/` tells a session to pass it on.

By hand: nothing.
