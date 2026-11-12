#!/usr/bin/env bash
# CC-1..4 — Claude in CI stays off pull-request trees and least-privilege
# (docs/conventions/claude-ci.md). Offline.
#   CC-1  every workflow carries `permissions: {}` at the top level.
#   CC-2  claude.yml is the only workflow that mentions a Claude secret or
#         action (comments count: Actions expands `${{ }}` in a `#` line of a
#         `run:` block), and none reads all the secrets. One exception:
#         claude-review.yml, the automated pull-request review, when the guard
#         that pins it byte for byte (45-claude-review.sh) is installed too.
#   CC-3  claude.yml is, byte for byte, the file CLAUDE_YML_DIGEST was taken
#         from, pins aside.
#   CC-4  those checks can fail: a table of broken copies must all go red, and
#         the pre-push hook in claude.yml, whose bytes alone CC-3 pins, must
#         behave.
# A digest rather than a reading of the YAML: no flow-style step, quoted key or
# `if: false` gets past it. A change made on purpose updates the digest in the
# same pull request. Pin bumps pass (their form is the business of GA-1).
. "$(dirname "$0")/_lib.sh"
shopt -s dotglob nullglob # GitHub loads a workflow named .x.yml

WF=.github/workflows
CLAUDE_YML_DIGEST=ac4f95ad8d53e640e2ba0e2ccc88a01be1c64251

if [ ! -f "$WF/claude.yml" ]; then
  fail "CC-3: $WF/claude.yml is missing — restore it, or remove this guard along with the workflow"
  finish
fi
command -v git >/dev/null 2>&1 || { fail "CC-3: git is needed to compute the digest"; finish; }

digest() {
  sed -E 's/^( *(- )?uses: [^@ ]+)@[0-9a-f]{40} # v[0-9.]+$/\1@SHA/' "$1" | git hash-object --stdin
}

# The review workflow is let in only next to the guard that pins it.
review_pinned=no
[ -f scripts/guards.d/45-claude-review.sh ] && review_pinned=yes

# check <workflows dir> [yes|no]: prints one line per problem; the caller counts
# them. The second argument says whether the review workflow is pinned.
check() {
  local dir=$1 pinned=${2:-$review_pinned} out got f extra=
  local files=("$dir"/*.yml "$dir"/*.yaml)

  out=$(grep -LxE 'permissions: *\{\}' "${files[@]}" || true)
  if [ -n "$out" ]; then echo "CC-1: no top-level 'permissions: {}' line in: $(echo $out)"; fi

  # Case-folded: secret names are case-insensitive when referenced.
  out=$(grep -liE 'CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY|anthropics/claude-code-|toJSON\(secrets\)|secrets\.\*|secrets\[|secrets: *inherit' "${files[@]}" || true)
  for f in $out; do
    case "$f" in
      "$dir/claude.yml") ;;
      "$dir/claude-review.yml") [ "$pinned" = yes ] || extra="$extra $f" ;;
      *) extra="$extra $f" ;;
    esac
  done
  if [ -n "$extra" ] || ! grep -qx "$dir/claude.yml" <<< "$out"; then
    echo "CC-2: only claude.yml (and claude-review.yml, pinned by 45-claude-review.sh) may touch a Claude secret, the action or all the secrets, got: $(echo $out)"
  fi

  got=$(digest "$dir/claude.yml")
  if [ "$got" != "$CLAUDE_YML_DIGEST" ]; then
    echo "CC-3: claude.yml is not the reviewed file: read its diff against the default branch, then set CLAUDE_YML_DIGEST=$got in scripts/guards.d/44-claude-ci.sh"
  fi
}

problems=$(check "$WF")
if [ -n "$problems" ]; then
  while IFS= read -r line; do fail "$line"; done <<EOF
$problems
EOF
  finish # every mutant below would be red, vacuously
fi
ok "CC-1: every workflow has a top-level 'permissions: {}'"
ok "CC-2: claude.yml alone touches the Claude secret and action, with the pinned review workflow if installed"
ok "CC-3: claude.yml is the reviewed file"

# The digest gathers pull-request titles into an issue: claude.yml refuses it
# by its label, so the label the digest applies must stay the refused one.
if [ -f scripts/weekly-digest.mjs ]; then
  if grep -qxF "const DIGEST_LABEL = 'weekly-digest';" scripts/weekly-digest.mjs; then
    ok "CC-3: the weekly digest labels its issue 'weekly-digest', which claude.yml refuses"
  else
    fail "CC-3: scripts/weekly-digest.mjs must label its issue 'weekly-digest' — claude.yml refuses digest issues by that label"
  fi
fi

# ── CC-4 — the checks above can fail ────────────────────────────────────────
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
base="$tmp/base"
cp -R "$WF" "$base"
# A second workflow to break, so the table does not depend on the project's own files.
printf 'name: Harness fixture\non: workflow_dispatch\npermissions: {}\njobs: {}\n' > "$base/zz-harness-fixture.yml"
if [ -n "$(check "$base")" ]; then fail "CC-4: the fixture set is not green before any mutation"; finish; fi

cc4=0
mutant() { # $1 = red|green, $2 = label, $3 = file, $4 = sed -E script, $5 = file to write if not $3, $6 = review pinned (default yes)
  local got out=${5:-$3}
  rm -rf "$tmp/wf"
  cp -R "$base" "$tmp/wf"
  sed -E "$4" "$base/$3" > "$tmp/wf/$out"
  if cmp -s "$base/$3" "$tmp/wf/$out"; then
    fail "CC-4: mutant '$2' changed nothing in $3"; cc4=1
    return 0
  fi
  if [ -z "$(check "$tmp/wf" "${6:-yes}" 2>/dev/null)" ]; then got=green; else got=red; fi
  if [ "$got" != "$1" ]; then fail "CC-4: mutant '$2' is $got, wanted $1"; cc4=1; fi
}

mutant red "one byte changed"               claude.yml 's/^name: Claude Code$/name: Claude Code /'
mutant red "action pinned to a tag"         claude.yml 's/(claude-code-action@)[0-9a-f]{40} # v[0-9.]+/\1v1/'
mutant red "pull requests let in"           claude.yml 's/!github\.event\.issue\.pull_request && //'
mutant red "a refused label dropped"        claude.yml "s/ && !contains\(github\.event\.issue\.labels\.\*\.name, 'weekly-digest'\)//"
mutant red "no permissions: {} elsewhere"   zz-harness-fixture.yml 's/^permissions: \{\}$/permissions: write-all/'
mutant red "second reader, odd case"        zz-harness-fixture.yml 's/^name: (.*)$/name: \1 ${{ secrets.claude_code_oauth_token }}/'
mutant red "second reader, all secrets"     zz-harness-fixture.yml 's/^name: (.*)$/name: \1 ${{ join(secrets.*, 1) }}/'
mutant red "second reader, in a comment"    zz-harness-fixture.yml 's/^name: (.*)$/# ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }} \1/'
mutant red "second reader, hidden file"     zz-harness-fixture.yml 's/^name: (.*)$/name: \1 ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}/' .x.yml
mutant red "a second Claude workflow"       zz-harness-fixture.yml 's/^name: (.*)$/name: \1 anthropics\/claude-code-base-action/' claude-triage.yml
mutant red "the review workflow, unpinned"  zz-harness-fixture.yml 's/^name: (.*)$/name: \1 anthropics\/claude-code-action/' claude-review.yml no
mutant green "the review workflow, pinned"  zz-harness-fixture.yml 's/^name: (.*)$/name: \1 anthropics\/claude-code-action/' claude-review.yml yes
mutant green "pin bump"                     claude.yml 's/(actions\/checkout@)[0-9a-f]{40} # v[0-9.]+/\1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb # v7.0.2/'

hook=$(sed -n "/<<'EOF_HOOK'/,/^ *EOF_HOOK\$/p" "$WF/claude.yml" | sed -e '1d' -e '$d' -e 's/^ *//')
push() { printf '0 0 %s 0\n' "$1" | sh -c "$hook" 2>/dev/null; }
if [ -z "$hook" ]; then fail "CC-4: no pre-push hook found in claude.yml"; cc4=1; fi
for ref in refs/heads/main refs/heads/claude/local-session refs/tags/v1.0.0; do
  if push "$ref"; then fail "CC-4: the pre-push hook lets $ref through"; cc4=1; fi
done
if ! push refs/heads/claude/issue-1-20260101-1800; then fail "CC-4: the pre-push hook refuses a session's own branch"; cc4=1; fi
[ "$cc4" -eq 1 ] || ok "CC-4: every broken copy goes red, a pin bump stays green, the pre-push hook holds"

finish
