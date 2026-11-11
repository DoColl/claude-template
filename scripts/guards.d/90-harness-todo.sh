#!/usr/bin/env bash
# Advisory: counts the gaps the kit left for the project to fill. Never fails —
# a new project is allowed to be unfinished, but it should know what is.
. "$(dirname "$0")/_lib.sh"

in_git || skip "not a git work tree"

marker='TODO(harn''ess)' # split so this file does not count itself
count=$(git grep -I -F -c -e "$marker" -- . 2>/dev/null | awk -F: '{ n += $NF } END { print n + 0 }')
if [ "$count" -gt 0 ]; then
  note "$count $marker marker(s) left to fill:"
  git grep -I -F -c -e "$marker" -- . | sed 's/^/          /'
else
  ok "no $marker marker left"
fi

finish
