bump: minor

- `parallel-sessions`: a session that works on an issue claims it before its first commit (`gh issue edit <n> --add-assignee @me`), stops and tells the user when the issue already has another assignee, and opens its pull request with `--assignee @me`. A session that drops an issue without a pull request removes its assignment and comments where the work stopped. The assignment is the one claim every session sees, across machines and in the cloud, where the report shows only pushed commits.
- `parallel-sessions`: a pull request that resolves an issue says `Closes #<n>` near the top of its body, one keyword per issue; one that only advances it says `Refs #<n>`. The line is there from the first push, since a branch cannot be linked to an issue after it was created. New section of the convention page, § Issues: the claim and the link, and a half-line in its suggested line for `CLAUDE.md`.
- `parallel-sessions`: the catch-up step before a pull request no longer assumes every change edits the version and the changelog. A change that takes a shared counter or heading takes the next free one; a project that collects changelog fragments has nothing to renumber. § Shared files names fragments as one way to give the changelog no single writer.
- All three are prose in the skill and on the convention page, exercised by no test; § Status says so.

By hand: nothing. A project that copied the line of `docs/conventions/parallel-sessions.md` § A line for `CLAUDE.md` into its own `CLAUDE.md` may add the new half-line about issues.
