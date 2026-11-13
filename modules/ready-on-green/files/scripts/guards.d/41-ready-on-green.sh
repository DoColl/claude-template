#!/usr/bin/env bash
# RG-1..3 — the workflow that lifts a draft on green CI
# (docs/conventions/ready-on-green.md). It runs with a write token on an
# event a pull request causes, so what it can do is pinned here:
#   RG-1  its only trigger is workflow_run. A pull_request trigger would run
#         the file as the pull request writes it, with the same token.
#   RG-2  it never checks the repository out, never merges, approves,
#         comments or pushes, and holds one permission: pull-requests: write.
#   RG-3  every job refuses a run that is not a green pull_request run of
#         this repository, and a branch a CI Claude session wrote; the draft
#         is lifted only after the head is read again and compared.
. "$(dirname "$0")/_lib.sh"

W=.github/workflows/ready-on-green.yml
[ -f "$W" ] || skip "RG-1: $W is not there — nothing to check"

# ─── RG-1 ───────────────────────────────────────────────────────────────
triggers=$(awk '/^on:/{f=1;next} f&&/^[^ #]/{f=0} f&&/^  [a-z_]+:/{sub(/:.*/,"");gsub(/ /,"");print}' "$W" | sort | tr '\n' ' ')
if [ "$triggers" = "workflow_run " ]; then
  ok "RG-1: the only trigger is workflow_run"
else
  fail "RG-1: $W must be triggered by workflow_run alone — found: ${triggers:-none}"
fi

# ─── RG-2 ───────────────────────────────────────────────────────────────
bad=""
grep -nE '^\s*-?\s*uses:' "$W" >/dev/null && bad="$bad an action (uses:);"
grep -nE 'gh pr (merge|review|comment|close|edit)|/merge|git push|gh api' "$W" | grep -vE '^\s*[0-9]+:\s*#' >/dev/null && bad="$bad a call other than \`gh pr list\`, \`gh pr view\` and \`gh pr ready\`;"
perms=$(grep -E '^\s+(actions|attestations|checks|contents|deployments|discussions|id-token|issues|models|packages|pages|pull-requests|repository-projects|security-events|statuses): ' "$W" | sed -E 's/ *#.*//; s/^ +//' | sort | tr '\n' ' ')
[ "$perms" = "pull-requests: write " ] || bad="$bad permissions other than pull-requests: write (${perms:-none});"
grep -qxF 'permissions: {}' "$W" || bad="$bad no \`permissions: {}\` at workflow level;"
if [ -z "$bad" ]; then
  ok "RG-2: no checkout, no action, no merge; one permission, pull-requests: write"
else
  fail "RG-2: $W holds$bad"
fi

# ─── RG-3 ───────────────────────────────────────────────────────────────
jobs=$(grep -cE '^  [a-z][a-z0-9_-]*:$' <(awk '/^jobs:/{f=1;next} f' "$W") || true)
missing=""
for cond in \
  "github.event.workflow_run.conclusion == 'success'" \
  "github.event.workflow_run.event == 'pull_request'" \
  "github.event.workflow_run.head_repository.full_name == github.repository" \
  "!startsWith(github.event.workflow_run.head_branch, 'claude/issue-')" \
  "!startsWith(github.event.workflow_run.head_branch, 'claude/rework-')"; do
  n=$(grep -cF "$cond" "$W" || true)
  [ "$n" = "$jobs" ] || missing="$missing [$cond]"
done
ready=$(grep -cE '^\s+gh pr ready ' "$W" || true)
compared=$(grep -cF 'if [ "$HEAD" != "$HEAD_SHA" ]; then' "$W" || true)
if [ "$jobs" -ge 1 ] && [ -z "$missing" ] && [ "$ready" -ge 1 ] && [ "$ready" = "$compared" ]; then
  ok "RG-3: the $jobs job(s) take green pull_request runs of this repository only, and lift a draft only on the validated head"
else
  fail "RG-3: $jobs job(s), $ready \`gh pr ready\`, $compared head comparison(s); conditions not on every job:${missing:- none}"
fi

finish
