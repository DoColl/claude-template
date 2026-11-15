#!/usr/bin/env bash
# CF-1 — no tracked text file holds a git conflict marker
# (docs/conventions/local-gate.md § Conflict markers).
#   CF-1  a line that starts with an opening, base or closing marker of a
#         conflict (`<<<<<<<`, `|||||||`, `>>>>>>>`, seven characters, then a
#         space or the end of the line) is refused in every tracked text file.
#         A rebase or a merge that stopped on a conflict, followed by commands
#         that stage the file and go on, commits the conflict as text; every
#         other guard can stay green on it. The separator `=======` alone is
#         not looked for: it underlines a Markdown heading, and a conflict
#         always carries an opening and a closing marker as well. A marker
#         shown as an example sits away from the start of its line (indented,
#         inside a fenced block too) — at column 0 it is refused wherever it is.
. "$(dirname "$0")/_lib.sh"

in_git || skip "CF-1: not a git work tree"

# -I leaves binary files out; tracked files only, as they stand in the tree.
re='^(<<<<<<<|[|]{7}|>>>>>>>)( |$)'
hits=$(git grep -I -n -E -e "$re" -- . 2>/dev/null)
if [ -n "$hits" ]; then
  n=$(printf '%s\n' "$hits" | wc -l | tr -d ' ')
  fail "CF-1: $n line(s) start with a git conflict marker — resolve the conflict, or indent a marker shown as an example:"
  printf '%s\n' "$hits" | cut -d: -f1,2 | head -20 | sed 's/^/          /' >&2
else
  ok "CF-1: no tracked file holds a git conflict marker"
fi

finish
