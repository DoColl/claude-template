bump: minor

- `core`: a new guard, CF-1 (`scripts/guards.d/10-conflict-markers.sh`), refuses a tracked text file with a line that starts with a git conflict marker (`<<<<<<<`, `|||||||`, `>>>>>>>`). A conflict committed as text, after a rebase or a merge that stopped on it, no longer passes the gate. A heading underlined with `=======` and an indented example stay green. The local gate's convention page gets § Conflict markers.

By hand: nothing. A project whose files show a conflict marker at the start of a line as an example indents it.
