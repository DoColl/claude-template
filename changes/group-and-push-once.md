bump: patch

- `parallel-sessions`: the skill and the convention page ask a session that takes several small issues to group them: one pull request per batch (or per theme, with a pull request of its own for a piece that needs its own review), one commit per issue with its `Closes` line, one push. A sub-agent commits to its own branch without pushing; the leading session collects its commits. Once the pull request is open, its description is written in full at creation, a label that holds the CI goes on before the next push, and the pull request is not brought up to date with the default branch unless it conflicts. New section § Fewer CI runs: CI runs per push and per event, not per commit, and one pull request per issue pays for the test job once per issue.

By hand: nothing. A project that copied the line of § A line for `CLAUDE.md` may add its new clause.
