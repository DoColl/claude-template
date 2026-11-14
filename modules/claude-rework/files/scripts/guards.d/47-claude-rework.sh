#!/usr/bin/env bash
# RW-1..3 — the rework of held pull requests stays what was reviewed
# (docs/conventions/claude-rework.md). Offline.
#   RW-1  claude-rework.yml is, byte for byte, the file REWORK_DIGEST was
#         taken from, pins aside: its trigger, the split between the Claude
#         job and the pushing job, the paths it refuses and the cap live there.
#   RW-2  claude-review.yml keeps its verdict as the run's artifact
#         claude-review-verdict, the only input the rework trusts.
#   RW-3  those checks can fail: a table of broken copies must all go red, and
#         a pin bump must stay green.
# The Claude secret's confinement is CR-2's (45-claude-review.sh), which lets
# claude-rework.yml in only next to this guard.
. "$(dirname "$0")/_lib.sh"

RW=.github/workflows/claude-rework.yml
REVIEW=.github/workflows/claude-review.yml
REWORK_DIGEST=d57d3e0d807470b784fa115f3300f000c7544ca1

command -v git >/dev/null 2>&1 || { fail "RW-1: git is needed to compute the digest"; finish; }

digest() {
  sed -E 's/^( *(- )?uses: [^@ ]+)@[0-9a-f]{40} # v[0-9.]+$/\1@SHA/' "$1" | git hash-object --stdin
}

# check <rework workflow> <review workflow>: one line per problem.
check() {
  local got
  if [ ! -f "$1" ]; then
    echo "RW-1: $1 is missing — restore it, or remove this guard along with it"
  else
    got=$(digest "$1")
    if [ "$got" != "$REWORK_DIGEST" ]; then
      echo "RW-1: $1 is not the reviewed file: read its diff against the default branch, then set REWORK_DIGEST=$got in scripts/guards.d/47-claude-rework.sh"
    fi
  fi
  if [ ! -f "$2" ]; then
    echo "RW-2: $2 is missing — the rework has no verdict to read"
  elif ! grep -qxF '          name: claude-review-verdict' "$2" \
     || ! grep -qF "'{pr: \$pr, head_sha: \$head, verdict: \$v, review: \$review}' > \"\$RUNNER_TEMP/verdict/verdict.json\"" "$2"; then
    echo "RW-2: $2 must keep its verdict as the artifact claude-review-verdict (verdict.json: pr, head_sha, verdict, review)"
  fi
}

problems=$(check "$RW" "$REVIEW")
if [ -n "$problems" ]; then
  while IFS= read -r line; do fail "$line"; done <<PROBLEMS
$problems
PROBLEMS
  finish
fi
ok "RW-1: claude-rework.yml is the reviewed file"
ok "RW-2: the review keeps its verdict as the run's artifact"

# ── RW-3 — the checks above can fail ────────────────────────────────────────
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
rw3=0
mutant() { # $1 = red|green, $2 = label, $3 = rework|review, $4 = sed -E script
  local r="$tmp/rework.yml" v="$tmp/review.yml" got
  cp "$RW" "$r"; cp "$REVIEW" "$v"
  if [ "$3" = rework ]; then sed -E "$4" "$RW" > "$r"; cmp -s "$RW" "$r" && { fail "RW-3: mutant '$2' changed nothing"; rw3=1; return 0; }
  else sed -E "$4" "$REVIEW" > "$v"; cmp -s "$REVIEW" "$v" && { fail "RW-3: mutant '$2' changed nothing"; rw3=1; return 0; }; fi
  if [ -z "$(check "$r" "$v")" ]; then got=green; else got=red; fi
  [ "$got" = "$1" ] || { fail "RW-3: mutant '$2' is $got, wanted $1"; rw3=1; }
}
mutant red   "started by the pull request"    rework 's/^  workflow_run: # zizmor: ignore\[dangerous-triggers\]$/  pull_request:/'
mutant red   "Bash made available"            rework 's/--tools Read,Grep,Glob,Edit,Write/--tools Read,Grep,Glob,Edit,Write,Bash/'
mutant red   "edits anywhere"                 rework 's/Edit\(\.rework\/pr\/\*\*\)/Edit/'
mutant red   "a third attempt"                rework 's/for k in 1 2; do/for k in 1 2 3; do/'
mutant red   "held paths let through"         rework 's/\|\^docs\/conventions\///'
mutant red   "an existing branch pushed to"   rework 's/ --force-with-lease="refs\/heads\/\$\{BRANCH\}:"//'
mutant red   "names quoted again"             rework 's/--name-only -z --no-renames\)/--name-only --no-renames)/'
mutant red   "links and modes let through"    rework "s/'mode change\|mode 120000\|mode 160000'/'never'/"
mutant red   "a .git kept in the tree"        rework '/find \.rework\/pr -iname \.git -prune -exec rm -rf/d'
mutant red   "Grep approved everywhere"       rework 's/--allowedTools Read\(\.\/\*\*\),/--allowedTools Read(.\/**),Grep,Glob,/'
mutant red   ".gitattributes let through"     rework 's/\|\(\^\|\/\)\\\.gitattributes\$//'
mutant red   "no concurrency group"           rework '/^  group: claude-rework-/d'
mutant red   "failed attempts not counted"    rework 's/startswith\("Automated rework started"\)/startswith("never")/'
mutant red   "a commit reworked twice"        rework 's/if \[ "\$SEEN" != "0" \]; then/if false; then/'
mutant red   "the verdict not kept"           review 's/^          name: claude-review-verdict$/          name: verdict/'
mutant red   "propose cannot read the patch"  rework '/^      actions: read # this run.s rework-patch artifact$/d'
mutant green "pin bump"                       rework 's/(actions\/checkout@)[0-9a-f]{40} # v[0-9.]+/\1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb # v7.0.2/'
[ "$rw3" -eq 1 ] || ok "RW-3: every broken copy goes red, a pin bump stays green"

finish
