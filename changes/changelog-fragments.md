bump: patch

- How the kit itself is released; no module changes with it. A pull request no longer writes the version or its `CHANGELOG.md` entry: it adds a fragment, `changes/<slug>.md`, with its level (`patch`, `minor` or `major`), the lines of its entry and its "By hand" part, so that pull requests written in parallel stop conflicting on the same lines. The format is at the top of `CHANGELOG.md`.
- `node bin/release.mjs` cuts a release, in a pull request of its own: the highest level among the fragments gives the next version, written to `kit.json` and `package.json`; the entry goes on top of `CHANGELOG.md` with one "By hand" part; the fragments are removed and `update .` records the version in the kit's own installation. `--dry-run` writes nothing. `.github/workflows/release.yml` still tags the merge.
- The tests check every fragment, and the kit's CI fails a pull request that changes `modules/`, `lib/` or `bin/` without adding one. A change to `CHANGELOG.md` or `changes/` now starts that CI.

By hand: nothing.
