#!/usr/bin/env bash
# CR-1..3 — the automated review stays read-only and off the pull request's
# tree (docs/conventions/claude-review.md). Offline.
#   CR-1  claude-review.yml is, byte for byte, the file CLAUDE_REVIEW_DIGEST
#         was taken from, pins and the CI workflow's name aside.
#   CR-2  claude-review.yml is the only workflow that mentions a Claude secret
#         or action (comments count: Actions expands `${{ }}` in a `#` line of
#         a `run:` block) — with claude.yml and claude-rework.yml, each only
#         next to the guard that pins it (44-claude-ci.sh, 47-claude-rework.sh)
#         — none reads all the secrets, and
#         claude-review.yml carries `permissions: {}` at the top level.
#   CR-3  those checks can fail: a table of broken copies must all go red, and
#         a pin bump must stay green.
# A digest rather than a reading of the YAML: no flow-style step, quoted key or
# `if: false` gets past it. A change made on purpose updates the digest in the
# same pull request. Pin bumps pass (their form is the business of GA-1).
. "$(dirname "$0")/_lib.sh"
shopt -s dotglob nullglob # GitHub loads a workflow named .x.yml

WF=.github/workflows
CLAUDE_REVIEW_DIGEST=ea4c9e3bb19aa59b127f042e28dc5602883fd877

if [ ! -f "$WF/claude-review.yml" ]; then
  fail "CR-1: $WF/claude-review.yml is missing — restore it, or remove this guard along with the workflow"
  finish
fi
command -v git >/dev/null 2>&1 || { fail "CR-1: git is needed to compute the digest"; finish; }

# Pins aside, and the name of the CI workflow the review follows, which the
# installer writes per project.
digest() {
  sed -E -e 's/^( *(- )?uses: [^@ ]+)@[0-9a-f]{40} # v[0-9.]+$/\1@SHA/' \
         -e 's/^    workflows: \["[A-Za-z0-9][A-Za-z0-9 ._-]{0,40}"\]$/    workflows: ["CI"]/' "$1" | git hash-object --stdin
}

# The issue workflow is let in only next to the guard that pins it.
issue_pinned=no
[ -f scripts/guards.d/44-claude-ci.sh ] && issue_pinned=yes
rework_pinned=no
[ -f scripts/guards.d/47-claude-rework.sh ] && rework_pinned=yes

# check <workflows dir> [yes|no]: prints one line per problem; the caller
# counts them. The second argument says whether claude.yml is pinned.
check() {
  local dir=$1 pinned=${2:-$issue_pinned} out f got bad=""
  local files=("$dir"/*.yml "$dir"/*.yaml)

  got=$(digest "$dir/claude-review.yml")
  if [ "$got" != "$CLAUDE_REVIEW_DIGEST" ]; then
    echo "CR-1: claude-review.yml is not the reviewed file: read its diff against the default branch, then set CLAUDE_REVIEW_DIGEST=$got in scripts/guards.d/45-claude-review.sh"
  fi

  # Case-folded: secret names are case-insensitive when referenced.
  out=$(grep -liE 'CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY|anthropics/claude-code-|toJSON\(secrets\)|secrets\.\*|secrets\[|secrets: *inherit' "${files[@]}" || true)
  # One name per line, never word-split or glob-expanded: a file named
  # claud[e].yml must not turn into claude.yml on its way here.
  while IFS= read -r f; do
    case "$f" in
      ''|"$dir/claude-review.yml") ;;
      "$dir/claude.yml") [ "$pinned" = yes ] || bad="$bad $f" ;;
      "$dir/claude-rework.yml") [ "${3:-$rework_pinned}" = yes ] || bad="$bad $f" ;;
      *) bad="$bad $f" ;;
    esac
  done <<< "$out"
  if [ -n "$bad" ]; then
    echo "CR-2: only claude-review.yml (and claude.yml and claude-rework.yml, each pinned by its guard) may touch a Claude secret, the action or all the secrets, got:$bad"
  fi
  if ! grep -qxE 'permissions: *\{\}' "$dir/claude-review.yml"; then
    echo "CR-2: claude-review.yml has no top-level 'permissions: {}' line"
  fi
}

problems=$(check "$WF")
if [ -n "$problems" ]; then
  while IFS= read -r line; do fail "$line"; done <<EOF
$problems
EOF
  finish # every mutant below would be red, vacuously
fi
ok "CR-1: claude-review.yml is the reviewed file"
ok "CR-2: claude-review.yml alone touches the Claude secret and action, with the pinned issue workflow if installed"

# ── CR-3 — the checks above can fail ────────────────────────────────────────
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
base="$tmp/base"
mkdir -p "$base"
cp "$WF/claude-review.yml" "$base/"
# A second workflow to break, so the table does not depend on the project's own files.
printf 'name: Harness fixture\non: workflow_dispatch\npermissions: {}\njobs: {}\n' > "$base/zz-harness-fixture.yml"
if [ -n "$(check "$base")" ]; then fail "CR-3: the fixture set is not green before any mutation"; finish; fi

cr3=0
mutant() { # $1 = red|green, $2 = label, $3 = file, $4 = sed -E script, $5 = file to write if not $3, $6 = claude.yml pinned (default yes)
  local got out=${5:-$3}
  rm -rf "$tmp/wf"
  cp -R "$base" "$tmp/wf"
  sed -E "$4" "$base/$3" > "$tmp/wf/$out"
  if cmp -s "$base/$3" "$tmp/wf/$out"; then
    fail "CR-3: mutant '$2' changed nothing in $3"; cr3=1
    return 0
  fi
  if [ -z "$(check "$tmp/wf" "${6:-yes}" "${6:-yes}" 2>/dev/null)" ]; then got=green; else got=red; fi
  if [ "$got" != "$1" ]; then fail "CR-3: mutant '$2' is $got, wanted $1"; cr3=1; fi
}

mutant red "one byte changed"               claude-review.yml 's/^name: Claude review$/name: Claude review /'
mutant red "started by the pull request"    claude-review.yml 's/^  workflow_run: # zizmor: ignore\[dangerous-triggers\]$/  pull_request:/'
mutant red "a commit named on every run"    claude-review.yml "s/ \\|\\| 'Claude review, nothing to review'//"
mutant red "credentials kept"               claude-review.yml 's/persist-credentials: false/persist-credentials: true/'
mutant red "binary files let through"       claude-review.yml "/'\\^Binary files '/d"
mutant red "Bash allowed"                   claude-review.yml 's/--allowedTools Read,Grep,Glob/--allowedTools Read,Grep,Glob,Bash/'
mutant red "Bash made available"            claude-review.yml 's/--tools Read,Grep,Glob/--tools Read,Grep,Glob,Bash/'
mutant red "forks let in"                   claude-review.yml 's/^(    if: .*) && github\.event\.workflow_run\.head_repository\.full_name == github\.repository/\1/'
mutant red "action pinned to a tag"         claude-review.yml 's/(claude-code-action@)[0-9a-f]{40} # v[0-9.]+/\1v1/'
mutant red "second reader"                  zz-harness-fixture.yml 's/^name: (.*)$/name: \1 ${{ secrets.claude_code_oauth_token }}/'
mutant red "second reader, all secrets"     zz-harness-fixture.yml 's/^name: (.*)$/name: \1 ${{ toJSON(secrets) }}/'
mutant red "a third Claude workflow"        zz-harness-fixture.yml 's/^name: (.*)$/name: \1 anthropics\/claude-code-base-action/' claude-triage.yml
mutant red "a name that globs to claude.yml" zz-harness-fixture.yml 's/^name: (.*)$/name: \1 ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}/' 'claud[e].yml'
mutant red "the issue workflow, unpinned"  zz-harness-fixture.yml 's/^name: (.*)$/name: \1 ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}/' claude.yml no
mutant red "the rework workflow, unpinned"  zz-harness-fixture.yml 's/^name: (.*)$/name: \1 ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}/' claude-rework.yml no
mutant green "the issue workflow, pinned"  zz-harness-fixture.yml 's/^name: (.*)$/name: \1 ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}/' claude.yml yes
mutant green "pin bump"                     claude-review.yml 's/(actions\/checkout@)[0-9a-f]{40} # v[0-9.]+/\1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb # v7.0.2/'
mutant green "another CI workflow name"     claude-review.yml 's/^    workflows: \[".*"\]$/    workflows: ["Tests on every push"]/'
[ "$cr3" -eq 1 ] || ok "CR-3: every broken copy goes red, a pin bump stays green"

finish
