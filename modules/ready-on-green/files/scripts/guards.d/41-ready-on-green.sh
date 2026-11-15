#!/usr/bin/env bash
# RG-1..5 — the workflow that lifts a draft on green CI
# (docs/conventions/ready-on-green.md). It runs with a write token on an
# event a pull request causes, so what it can do is pinned here:
#   RG-1  its only trigger is workflow_run. A pull_request trigger would run
#         the file as the pull request writes it, with the same token.
#   RG-2  it never checks the repository out, never merges, approves,
#         comments or pushes, and holds the two permissions lifting a draft
#         needs with the job token: pull-requests: write and contents: write.
#         contents: write would let a step push: the same check refuses any
#         call but `gh pr list`, `gh pr view` and `gh pr ready`.
#   RG-3  every job refuses a run that is not a green pull_request run of
#         this repository, and a branch a CI Claude session wrote; the draft
#         is lifted only after the head is read again and compared.
#   RG-4  a pull request labelled session-active keeps its draft: the label
#         is read with the pull request, and checked before the pull request
#         is named to the step that lifts it. A session still at work on its
#         pull request says so with the label; green CI is not its work done.
#   RG-5  a CI workflow (the one named at install) that holds a job while a
#         draft is labelled session-active holds every job, with the
#         condition as the page writes it, alone or followed by `&&`, and
#         lists `unlabeled` and `ready_for_review` among its pull_request
#         types. A run where one job ran and the others were held ends
#         `success`: if the label comes off before this workflow reads the
#         pull request, the draft is lifted on checks that never ran. A CI
#         workflow without the condition is not concerned.
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
[ "$perms" = "contents: write pull-requests: write " ] || bad="$bad permissions other than pull-requests: write and contents: write (${perms:-none});"
grep -qxF 'permissions: {}' "$W" || bad="$bad no \`permissions: {}\` at workflow level;"
if [ -z "$bad" ]; then
  ok "RG-2: no checkout, no action, no merge; two permissions, pull-requests: write and contents: write"
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

# ─── RG-4 ───────────────────────────────────────────────────────────────
read_label=$(grep -cF 'any(.labels[]?; .name == "session-active")' "$W" || true)
held_at=$(grep -nF 'if [ "$HELD" = "true" ]; then' "$W" | head -n 1 | cut -d: -f1)
named_at=$(grep -nF 'echo "pr=$PR" >> "$GITHUB_OUTPUT"' "$W" | head -n 1 | cut -d: -f1)
if [ "$read_label" -ge 1 ] && [ -n "$held_at" ] && [ -n "$named_at" ] && [ "$held_at" -lt "$named_at" ]; then
  ok "RG-4: a pull request labelled session-active keeps its draft"
else
  fail "RG-4: $W must read the session-active label and stop on it before it names the pull request to lift"
fi

# ─── RG-5 ───────────────────────────────────────────────────────────────
ci_name='__HARNESS_CI_WORKFLOW__'
ci=""
for f in .github/workflows/*.yml .github/workflows/*.yaml; do
  [ -f "$f" ] || continue
  # The `name:` as the weekly digest reads it: quoted, or up to a comment.
  n=$(sed -nE 's/^name:[[:space:]]*//p' "$f" | head -n 1)
  case "$n" in
    \"*) n=${n#\"}; n=${n%%\"*} ;;
    \'*) n=${n#\'}; n=${n%%\'*} ;;
    *) n=$(printf '%s' "$n" | sed -E 's/[[:space:]]+#.*$//; s/[[:space:]]+$//') ;;
  esac
  if [ "$n" = "$ci_name" ]; then ci=$f; break; fi
done
held="!(github.event.pull_request.draft && contains(github.event.pull_request.labels.*.name, 'session-active'))"
if [ -z "$ci" ]; then
  ok "RG-5: no workflow named $ci_name here — no CI job to hold"
elif ! grep -qF "'session-active'" "$ci"; then
  ok "RG-5: $ci does not hold its jobs for session-active"
else
  # One line per job: its name, then `ok` when it has exactly one `if:` that
  # is the hold alone or the hold followed by `&&` (no `||`, which could undo
  # it). Jobs are read at two spaces of indentation, their keys at four.
  verdicts=$(awk -v held="$held" '
    function close_job() { if (name != "") print name, (ifs == 1 && good ? "ok" : "bad") }
    /^jobs:[[:space:]]*$/ { j = 1; next }
    j && /^[^[:space:]#]/ { j = 0 }
    !j { next }
    /^  [A-Za-z0-9_-]+:[[:space:]]*$/ { close_job(); name = $1; sub(/:$/, "", name); ifs = 0; good = 0; next }
    /^    if:/ {
      ifs++; c = $0; sub(/^    if:[[:space:]]*/, "", c); sub(/[[:space:]]+$/, "", c)
      alone = "${{ " held " }}"; first = "${{ " held " && "
      if (c == alone || (index(c, first) == 1 && substr(c, length(c) - 2) == " }}" && index(c, "||") == 0)) good = 1
    }
    END { close_job() }
  ' "$ci")
  total=$(printf '%s\n' "$verdicts" | grep -c . || true)
  unheld=$(printf '%s\n' "$verdicts" | awk '$2 == "bad" { printf " %s", $1 }')
  types=$(awk '/^on:/{o=1;next} o&&/^[^[:space:]#]/{o=0} o&&/^  pull_request:/{p=1;next} p&&/^  [^[:space:]]/{p=0} p&&/^    types:/{print;exit}' "$ci")
  missing=""
  for t in unlabeled ready_for_review; do
    printf '%s' "$types" | grep -qE "[[ ,]$t[] ,]" || missing="$missing $t"
  done
  if [ "$total" -eq 0 ]; then
    fail "RG-5: $ci holds jobs for session-active, and no job could be read (jobs at two spaces of indentation)"
  elif [ -n "$unheld" ] || [ -n "$missing" ]; then
    [ -n "$unheld" ] && fail "RG-5: $ci holds jobs for session-active, and these do not carry the hold as written, alone or followed by &&:$unheld"
    [ -n "$missing" ] && fail "RG-5: $ci holds jobs for session-active, and its pull_request types (one line, [ … ]) lack:$missing"
  else
    ok "RG-5: $ci holds all its $total job(s) for session-active, and runs them once the label comes off"
  fi
fi

finish
