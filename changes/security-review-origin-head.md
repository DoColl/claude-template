bump: patch

- `security-review`: the convention page gains § Running `/security-review` in a fresh container. The built-in pass diffs against `origin/HEAD`, which a fresh clone often lacks, and it needs the change committed; the section gives the two commands that fix it (`git remote set-head origin <default-branch>`, then commit), and says that a pass that cannot run is reported in the pull request, not replaced silently.

By hand: nothing.
