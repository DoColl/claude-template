#!/usr/bin/env bash
# PS-1..2 — several sessions working in one repository
# (docs/conventions/parallel-sessions.md).
#   PS-1  .claude/worktrees/, where Claude Code puts the worktree of a session,
#         stays ignored by git and nothing under it is tracked. A worktree is a
#         checkout of the same repository: staged from the main checkout by a
#         `git add -A`, it is recorded as a repository inside the repository,
#         at whatever commit a session left it.
#   PS-2  a note, never a failure: this branch is behind the default branch as
#         last fetched — catch up before a pull request — and, first of all,
#         that branch changed files this one also changes — catch up before
#         pushing. It says nothing when it has nothing to report, because the
#         last fetch may be old and silence must not read as "up to date"; and
#         nothing on a runner, where the pull request page says the same.
. "$(dirname "$0")/_lib.sh"

if ! in_git; then
  note "PS-1: not a git repository — what git tracks and ignores was not checked"
  finish
fi

tracked=$(git ls-files -- .claude/worktrees | head -n 3 | tr '\n' ' ')
if [ -n "$tracked" ]; then
  fail "PS-1: git tracks paths under .claude/worktrees/ — remove them from the index (git rm -r --cached .claude/worktrees): $tracked"
elif ! git check-ignore -q .claude/worktrees/probe 2>/dev/null; then
  fail "PS-1: .claude/worktrees/ is not ignored — add it to .gitignore before a session's worktree is staged by a git add -A"
else
  ok "PS-1: .claude/worktrees/ is ignored and nothing under it is tracked"
fi

if [ -z "${CI:-}" ] && [ -f scripts/parallel-sessions.sh ]; then
  finding=$(bash scripts/parallel-sessions.sh --check 2>/dev/null) || finding=""
  if [ -n "$finding" ]; then
    note "PS-2: $finding"
  fi
fi

finish
