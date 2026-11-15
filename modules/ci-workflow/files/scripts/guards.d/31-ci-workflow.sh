#!/usr/bin/env bash
# CW-1, CW-2, CW-3 — the shape of .github/workflows/ci.yml that keeps every
# change scanned and every required check reporting
# (docs/conventions/ci-workflow.md). The file is the project's: only what
# these three rules name is checked, the rest is its own.
#
#   CW-1  the workflow runs on every pull request and every push: `on:` names
#         pull_request and push, and no trigger has a `paths` or
#         `paths-ignore` filter. A pull request it skips gets no run, so a
#         check the ruleset requires never reports, nothing waiting for CI
#         merges it, and its files are never scanned.
#   CW-2  the job that calls security.yml (the secret scan and the gate) runs
#         on every one of them: it needs no other job and its `if:`, if any,
#         does not read `changes`.
#   CW-3  the `changes` job, when there is one, fails closed. Its script, the
#         lines between `# harness:changes-begin` and `# harness:changes-end`
#         and the whole of its run block, is run on a table of changes built
#         in scratch repositories: 'false' only when the diff was read and
#         every file in it is documentation, 'true' for anything else (code,
#         a rename out of code, a push of several commits, another event, no
#         repository). The job's output, the step's id and its two env values
#         are pinned, so that what is tested is what the jobs read.
. "$(dirname "$0")/_lib.sh"
cd "$(dirname "$0")/../.." || exit 1
set -uo pipefail

CIWF=.github/workflows/ci.yml
if [ ! -f "$CIWF" ]; then
  fail "CW-1: $CIWF is missing — the ci-workflow module installs it; put it back or remove the module"
  finish
fi

# The `on:` block: from its key to the next top-level key, comments aside.
on_block=$(awk -v key="^[\"']?on[\"']?[[:space:]]*:" '$0 ~ key { f = 1; print; next } f && /^[^[:space:]#]/ { exit } f' "$CIWF" \
  | grep -vE '^[[:space:]]*(#|$)' || true)
if [ -z "$on_block" ]; then
  fail "CW-1: $CIWF has no top-level on: key that this guard can read"
elif grep -qE "(^|[^A-Za-z0-9_-])[\"']?paths(-ignore)?[\"']?[[:space:]]*:" <<< "$on_block"; then
  fail "CW-1: $CIWF filters its triggers with paths or paths-ignore — run on every pull request and push, and skip the costly jobs on needs.changes.outputs.code instead (ci-workflow.md)"
elif ! grep -qE '(^|[^A-Za-z0-9_-])pull_request([^A-Za-z0-9_-]|$)' <<< "$on_block" \
     || ! grep -qE '(^|[^A-Za-z0-9_-])push([^A-Za-z0-9_-]|$)' <<< "$on_block"; then
  fail "CW-1: $CIWF must run on pull_request and on push"
else
  ok "CW-1: $CIWF runs on every pull request and push, with no path filter"
fi

# Every line of the jobs, tagged with its job: "<job>\t<line>".
jobs_tsv=$(awk '/^jobs:[[:space:]]*$/ { on = 1; next }
  on && /^[^[:space:]#]/ { exit }
  on && /^  [A-Za-z0-9_-]+:[[:space:]]*$/ { job = $1; sub(/:$/, "", job); next }
  on && job != "" { print job "\t" $0 }' "$CIWF")
job_lines() { awk -F'\t' -v j="$1" '$1 == j { sub(/^[^\t]*\t/, ""); print }' <<< "$jobs_tsv"; }

sec_jobs=$(awk -F'\t' '$2 ~ /^    uses:[[:space:]]+(\$|\.)\/\.github\/workflows\/security\.ya?ml[[:space:]]*(#.*)?$/ { print $1 }' <<< "$jobs_tsv" | sort -u)
if [ -z "$sec_jobs" ]; then
  fail "CW-2: no job of $CIWF calls security.yml (uses: \$/.github/workflows/security.yml) — the secret scan and the gate would not run in CI"
else
  cw2=0
  for j in $sec_jobs; do
    lines=$(job_lines "$j")
    if grep -qE '^    needs:' <<< "$lines"; then
      fail "CW-2: job '$j' calls security.yml but waits for another job — it must run first, on every change"; cw2=1
    fi
    if grep -E '^    if:' <<< "$lines" | grep -q 'changes'; then
      fail "CW-2: job '$j' calls security.yml but its if: reads changes — documentation must be scanned too"; cw2=1
    fi
  done
  [ "$cw2" = 0 ] && ok "CW-2: security.yml runs on every change, documentation included"
fi

if ! grep -qE '^  changes:[[:space:]]*$' <<< "$(sed -n '/^jobs:/,$p' "$CIWF")"; then
  note "CW-3: no changes job in $CIWF — every job runs on every change, documentation included"
  finish
fi
before_cw3=$failures
changes=$(job_lines changes)
cw3() { fail "CW-3: $1"; }
step=$(awk '/^      - / { s++ } s && /^        id: diff[[:space:]]*$/ { want = s } { line[NR] = $0; st[NR] = s }
  END { for (i = 1; i <= NR; i++) if (want && st[i] == want) print line[i] }' <<< "$changes")
if [ "$(grep -cxF '      code: ${{ steps.diff.outputs.code }}' <<< "$changes")" != "1" ] \
   || [ "$(grep -cE '^      [A-Za-z0-9_-]+:' <<< "$(awk '/^    outputs:/ { f = 1; next } f && /^    [^ ]/ { f = 0 } f' <<< "$changes")")" != "1" ]; then
  cw3 "the changes job must have one output, on the pinned line 'code: \${{ steps.diff.outputs.code }}'"
fi
if [ -z "$step" ] \
   || ! grep -qxF '          EVENT: ${{ github.event_name }}' <<< "$step" \
   || ! grep -qxF '          BEFORE: ${{ github.event.before }}' <<< "$step"; then
  cw3 "the changes job's step 'id: diff' must set EVENT: \${{ github.event_name }} and BEFORE: \${{ github.event.before }}"
fi
# The run block: from `run: |` to the first line indented no deeper than it. Outside the
# markers, blank lines only: nothing after the script can write another value.
run=$(awk '/^        run: \|[[:space:]]*$/ { f = 1; next } f && /[^[:space:]]/ && !/^         / { exit } f' <<< "$step")
indent=$(sed -n 's/^\( *\)# harness:changes-begin$/\1/p' <<< "$run" | head -n 1)
script=$(awk '/^ *# harness:changes-end$/ { f = 0 } f { print } /^ *# harness:changes-begin$/ { f = 1 }' <<< "$run" | sed "s/^$indent//")
outside=$(awk '/^ *# harness:changes-begin$/ { f = 1; next } /^ *# harness:changes-end$/ { f = 0; next } !f' <<< "$run" | grep -c '[^[:space:]]' || true)
if [ -z "$indent" ] || [ -z "$script" ] || [ "$outside" != "0" ] \
   || [ "$(grep -c '# harness:changes-begin$' <<< "$run")" != "1" ] || [ "$(grep -c '# harness:changes-end$' <<< "$run")" != "1" ]; then
  cw3 "the run block of the step 'id: diff' must be the script between one '# harness:changes-begin' and one '# harness:changes-end', and nothing else"
  finish
fi
if ! command -v git >/dev/null 2>&1; then
  if [ -n "${CI:-}" ]; then cw3 "git is needed to run the table"; finish; fi
  skip "CW-3: git is not installed"
fi

# The table. Each row builds a scratch repository, runs the script in it the
# way a runner does (bash -e) and reads GITHUB_OUTPUT: exactly one code= line,
# with the value expected. A failing script fails its row: the job would fail.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
printf '%s\n' "$script" > "$tmp/changes.sh"
g() { git -c user.name=guard -c user.email=guard@example.invalid -c commit.gpgsign=false -c init.defaultBranch=main "$@"; }
# A repository with code and documentation on main.
base_repo() {
  mkdir -p "$1/src" "$1/docs" && cd "$1" || return 1
  g init -q
  echo a > src/app.js; echo a > docs/guide.md; echo a > README.md; echo a > LICENSE
  g add -A && g commit -q -m base
}
# The merge commit GitHub builds for a pull request whose branch ran "$@".
pr_merge() {
  g checkout -q -b feature && "$@" && g add -A && g commit -q --allow-empty -m change \
    && g checkout -q main && g commit -q --allow-empty -m 'main moved' && g merge -q --no-ff -m merge feature
}
edit_docs() { echo b >> docs/guide.md; }
edit_readme() { echo b >> README.md; }
edit_code() { echo b >> src/app.js; }
edit_both() { echo b >> docs/guide.md; echo b >> src/app.js; }
move_code() { g mv src/app.js docs/app.md; }
edit_workflow() { mkdir -p .github/workflows && echo 'name: x' > .github/workflows/x.yml; }
quoted_md() { echo b > "docs/caf$(printf '\303\251').md"; }
nothing() { :; }
row() { # row <expected> <label> <event> <setup…>: setup runs in the repository and prints BEFORE
  local want=$1 label=$2 event=$3 dir out before status got
  shift 3
  dir=$(mktemp -d "$tmp/row.XXXXXX")
  out="$dir.out"; : > "$out"
  before=$( (unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_PREFIX GIT_COMMON_DIR; cd "$dir" && "$@") 2>/dev/null) || { cw3 "row '$label': the scratch repository could not be built"; return; }
  ( unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_PREFIX GIT_COMMON_DIR
    cd "$dir/repo" 2>/dev/null || cd "$dir"
    EVENT=$event BEFORE=$before GITHUB_OUTPUT=$out GIT_CEILING_DIRECTORIES=$dir bash -e "$tmp/changes.sh" ) >/dev/null 2>&1
  status=$?
  got=$(grep -c '^code=' "$out" || true)
  if [ "$status" != 0 ]; then
    cw3 "row '$label': the script exited $status — it must write code=$want and succeed"
  elif [ "$got" != 1 ] || ! grep -qx "code=$want" "$out"; then
    cw3 "row '$label': expected one line code=$want, got: $(grep '^code=' "$out" | tr '\n' ' ')"
  fi
}
pr() { base_repo repo && pr_merge "$1"; }
push_one() { base_repo repo && g rev-parse HEAD && "$1" && g add -A && g commit -q -m push; }
push_two() { base_repo repo && g rev-parse HEAD && edit_docs && g commit -q -am one && edit_readme && g commit -q -am two; }
push_unknown() { base_repo repo && edit_docs && g commit -q -am one; }
not_merged() { base_repo repo && edit_docs && g commit -q -am one; }
no_repo() { mkdir repo; }

row false "a pull request that edits docs/" pull_request pr edit_docs
row false "a pull request that edits README.md" pull_request pr edit_readme
row false "a single-commit push that edits docs/" push push_one edit_docs
row true "a pull request that edits code" pull_request pr edit_code
row true "a pull request that edits docs and code" pull_request pr edit_both
row true "a pull request that moves code into docs/" pull_request pr move_code
row true "a pull request that adds a workflow" pull_request pr edit_workflow
row true "a pull request with a quoted name" pull_request pr quoted_md
row true "a pull request that changes nothing" pull_request pr nothing
row true "a pull request whose HEAD is not a merge commit" pull_request not_merged
row true "a single-commit push that edits code" push push_one edit_code
row true "a push of two commits" push push_two
row true "a push whose previous tip is not known" push push_unknown
row true "a scheduled run" schedule pr edit_docs
row true "a manual run" workflow_dispatch pr edit_docs
row true "no repository" pull_request no_repo
[ "$failures" = "$before_cw3" ] && ok "CW-3: the changes job says 'false' only for a documentation-only diff it could read, 'true' for the 13 other rows"
finish
