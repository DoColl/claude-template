#!/usr/bin/env bash
# RR-1 — the pull request description carries a current review record
# (docs/conventions/review-tiers.md § Leave a record in the pull request).
#   RR-1  the description has a `## Review record` section, and that section
#         names the head the pull request has now: a hexadecimal token of seven
#         characters or more that is a prefix of the head commit. A record
#         that is missing, or that names an earlier head, is a record to
#         write or to renew. It shows that a statement was made; it does not
#         prove the passes were good.
# The description is untrusted input: it is read from a file or an
# environment variable, never put on a command line or in a workflow `run:`,
# and the guard never prints any of it.
# Inputs (none set: the check is skipped, so a run on a laptop stays green):
#   PR_BODY_FILE  a file that holds the description, or
#   PR_BODY       the description itself (set from `env:` in a workflow);
#   PR_HEAD_SHA   the head of the pull request. A run on a pull request checks
#                 out a merge commit, not the head: set it there. Defaults to
#                 `git rev-parse HEAD`.
# A pull request is recognised by PR_BODY_FILE, or by PR_HEAD_SHA being set;
# a run on a push or on a schedule sets neither and is skipped.
# Advisory: a finding is a note and, on a runner, a warning annotation. Set
# REVIEW_RECORD=enforce to turn it into a failure.
. "$(dirname "$0")/_lib.sh"

if [ -n "${PR_BODY_FILE:-}" ]; then
  [ -f "$PR_BODY_FILE" ] || { fail "RR-1: PR_BODY_FILE does not name a file"; finish; }
  body=$(cat "$PR_BODY_FILE")
elif [ -n "${PR_HEAD_SHA:-}" ]; then
  body=${PR_BODY:-}
else
  skip "RR-1: not a pull request run (no PR_BODY_FILE, no PR_HEAD_SHA)"
fi

head=${PR_HEAD_SHA:-}
if [ -z "$head" ]; then
  in_git || skip "RR-1: no head commit to compare with"
  head=$(git rev-parse HEAD 2>/dev/null) || skip "RR-1: no head commit to compare with"
fi
head=$(printf '%s' "$head" | tr 'A-F' 'a-f')
case "$head" in *[!0-9a-f]* | "") fail "RR-1: PR_HEAD_SHA is not a commit hash"; finish ;; esac

# The section: from the heading to the next level-1 or level-2 heading, with
# carriage returns removed (a description edited on the web has CRLF). Fenced
# code is not special-cased: a heading shown inside a fence ends the section.
section=$(printf '%s\n' "$body" | tr -d '\r' | awk '
  /^##[ \t]+[Rr]eview [Rr]ecord[ \t]*$/ { on = 1; next }
  on && /^##?[ \t]/ { exit }
  on { print }')
found=$(printf '%s\n' "$body" | tr -d '\r' | grep -c -E '^##[ \t]+[Rr]eview [Rr]ecord[ \t]*$' || true)

problem=""
if [ "$found" -eq 0 ]; then
  problem="the description has no \`## Review record\` section"
else
  named=""
  for tok in $(printf '%s\n' "$section" | tr 'A-F' 'a-f' | grep -o -E '[0-9a-f]{7,40}' || true); do
    case "$head" in "$tok"*) named=$tok; break ;; esac
  done
  [ -n "$named" ] || problem="the \`## Review record\` section does not name the current head ${head:0:12}: renew it, or say that it is stale"
fi

if [ -z "$problem" ]; then
  ok "RR-1: the review record names the head ${head:0:12}"
elif [ "${REVIEW_RECORD:-}" = enforce ]; then
  fail "RR-1: $problem"
else
  note "RR-1: $problem (advisory)"
  [ "${GITHUB_ACTIONS:-}" = true ] && printf '::warning::RR-1: %s\n' "$problem"
fi

finish
