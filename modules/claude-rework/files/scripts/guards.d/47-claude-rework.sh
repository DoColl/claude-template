#!/usr/bin/env bash
# RW-1..3 — the rework of held pull requests keeps its instructions and its
# trigger (docs/conventions/claude-rework.md). Offline.
#   RW-1  .claude/routines/rework.md is, byte for byte, the file
#         REWORK_DIGEST was taken from: the cap, the branch it may push, the
#         paths it may not touch and "never merge" live there, and the
#         scheduled task follows that file as the default branch holds it.
#   RW-2  claude-review.yml labels a held pull request review-held, the event
#         the scheduled task starts on, and removes it on a pass.
#   RW-3  those checks can fail: a table of broken copies must all go red.
# A deliberate change to rework.md updates the digest in the same pull request.
. "$(dirname "$0")/_lib.sh"

RW=.claude/routines/rework.md
REVIEW=.github/workflows/claude-review.yml
REWORK_DIGEST=0f08c67fe828d7f52ab9a6395792b11ae030d0d4

command -v git >/dev/null 2>&1 || { fail "RW-1: git is needed to compute the digest"; finish; }

# check <rework file> <review workflow>: one line per problem.
check() {
  local got
  if [ ! -f "$1" ]; then
    echo "RW-1: $1 is missing — restore it, or remove this guard along with it"
  else
    got=$(git hash-object "$1")
    if [ "$got" != "$REWORK_DIGEST" ]; then
      echo "RW-1: $1 is not the reviewed file: read its diff against the default branch, then set REWORK_DIGEST=$got in scripts/guards.d/47-claude-rework.sh"
    fi
  fi
  if [ ! -f "$2" ]; then
    echo "RW-2: $2 is missing — the rework has nothing to start on"
  elif ! grep -qF 'gh pr edit "$PR" --add-label review-held' "$2" \
     || ! grep -qF 'gh pr edit "$PR" --remove-label review-held' "$2"; then
    echo "RW-2: $2 must label a held pull request review-held and remove the label on a pass"
  fi
}

problems=$(check "$RW" "$REVIEW")
if [ -n "$problems" ]; then
  while IFS= read -r line; do fail "$line"; done <<PROBLEMS
$problems
PROBLEMS
  finish
fi
ok "RW-1: .claude/routines/rework.md is the reviewed file"
ok "RW-2: the review labels held pull requests review-held"

# ── RW-3 — the checks above can fail ────────────────────────────────────────
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
rw3=0
mutant() { # $1 = label, $2 = rework|review, $3 = sed -E script
  local r="$tmp/rework.md" v="$tmp/review.yml"
  cp "$RW" "$r"; cp "$REVIEW" "$v"
  if [ "$2" = rework ]; then sed -E -i.bak "$3" "$r"; cmp -s "$RW" "$r" && { fail "RW-3: mutant '$1' changed nothing"; rw3=1; return 0; }
  else sed -E -i.bak "$3" "$v"; cmp -s "$REVIEW" "$v" && { fail "RW-3: mutant '$1' changed nothing"; rw3=1; return 0; }; fi
  if [ -z "$(check "$r" "$v")" ]; then fail "RW-3: mutant '$1' stays green"; rw3=1; fi
}
mutant "a third attempt allowed"        rework 's/\*\*Two or more exist\*\*/**Three or more exist**/'
mutant "push to the held branch"        rework '/^- Push to the held pull request/d'
mutant "a gated path let through"       rework 's/ `docs\/conventions\/`,//'
mutant "no label on a hold"             review 's/--add-label review-held/--add-label held/'
mutant "the label kept on a pass"       review 's/--remove-label review-held/--remove-label other/'
[ "$rw3" -eq 1 ] || ok "RW-3: every broken copy goes red"

finish
