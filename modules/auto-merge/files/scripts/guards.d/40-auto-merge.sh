#!/usr/bin/env bash
# AM-1, AM-4, AM-5, AM-6, AM-7 — invariants of .github/workflows/auto-merge.yml
# (docs/conventions/auto-merge-policy.md). That workflow merges pull requests
# with nobody watching, so what it must never do is pinned here.
#
#   AM-1  the Claude-config gate. CLAUDE_GATE_RE is run on a table of paths —
#         its BEHAVIOUR is tested, not its text — it is defined exactly once,
#         every job that merges applies it, and every one refuses a
#         claude/issue-* head. PROJECT_GATE_RE, the project's additions, is
#         defined once too and applied in the same grep; the rows of
#         scripts/auto-merge-paths.txt are run on the two patterns together.
#   AM-7  the gate judges the range that is merged: files and commits come
#         from compare/<base commit>...<validated head>, never from the pull
#         request's current state, and the base is re-read before each merge.
#         A pull request that cannot be read fails the job instead of passing
#         for a moved head.
#   AM-4  marking a pull request ready never merges it. The two ready lines are
#         pinned to their exact text, and every merge call in the file, however
#         it is spelled, is one of the gated REST calls AM-1 counts.
#   AM-5  Dependabot. The workflow's own dependabot_verdict and bump_level,
#         extracted from between their markers, are run on the commit-body
#         shapes that must merge and on the ones that must hold; the author
#         check, the exact `merge` verdict and MAJOR_HOLD_RE are pinned, and
#         dependabot.yml must not widen version updates (`allow`).
#   AM-6  the merge is the commit CI validated, of one CI workflow: a single
#         workflow name is waited for, the pull request is selected by its head
#         SHA, every merge call passes that SHA, and the SHA comes from the
#         triggering event.
#
# AM-2 and AM-3 are unused on purpose. In the workflow this guard was first
# written for, they covered a post-merge deploy dispatch: whether the default
# branch moved while the pull request's CI ran, and whether the deploy waited
# for the end-to-end tests. The kit ships no dispatch, so they have nothing to
# check. If you add one (auto-merge-policy.md § After the merge), bring them
# back under those numbers.
. "$(dirname "$0")/_lib.sh"
cd "$(dirname "$0")/../.." || exit 1
set -uo pipefail

AM=.github/workflows/auto-merge.yml
group=0 # failures of the check being run
bad() { fail "AM-$1: $2"; group=$((group + 1)); }
pass() { if [ "$group" -eq 0 ]; then ok "AM-$1: $2"; fi; group=0; }

if [ ! -f "$AM" ]; then
  fail "AM-1: $AM is missing"
  finish
fi

# ── AM-1 — Claude-config gate ────────────────────────────────────────────────
RE=$(sed -n "s/^  CLAUDE_GATE_RE: '\(.*\)'$/\1/p" "$AM")
if [ -z "$RE" ]; then
  bad 1 "CLAUDE_GATE_RE is not defined (single-quoted) in the workflow env of $AM"
else
  # Must be gated: any .claude/ directory at any depth (and a bare .claude
  # entry), CLAUDE.md / CLAUDE.local.md anywhere, case variants (a
  # case-insensitive file system folds them), the git hooks directory, a
  # project MCP config, the other files a Claude CI action reads as
  # configuration, and what runs Claude in CI or enforces all this.
  for p in CLAUDE.md claude.md sub/CLAUDE.md CLAUDE.local.md \
           .claude/agents/x.md sub/.Claude/agents/x.md sub/.claude \
           .CLAUDE/settings.local.json .claude/harness.json .githooks/pre-commit \
           .mcp.json sub/.mcp.json .claude.json .ripgreprc .gitmodules \
           .husky/pre-commit sub/.ripgreprc \
           .github/workflows/claude.yml .github/workflows/claude-review.yml \
           .github/workflows/auto-merge.yml scripts/guards.d/40-auto-merge.sh \
           scripts/guards.d/44-claude-ci.sh scripts/reviewed-plugins.json \
           scripts/security-checks.sh scripts/guards.d/50-project.sh \
           scripts/guards.d/_lib.sh scripts/guards.d/60-new.sh \
           scripts/plugin-pins.mjs scripts/plugin-pins.test.mjs \
           scripts/fetch-pinned-release.sh .gitleaks.toml .gitleaksignore \
           .github/zizmor.yml .github/zizmor.yaml scripts/auto-merge-paths.txt; do
    if ! grep -qiE "$RE" <<< "$p"; then bad 1 "gated path NOT matched by CLAUDE_GATE_RE: $p"; fi
  done
  # Must not be gated: ordinary docs, code and scripts.
  for p in README.md docs/foo.md docs/conventions/auto-merge-policy.md x/claudette.md \
           src/claude.service.ts .gitignore LICENSE src/claude/x.ts \
           .github/workflows/ci.yml .github/dependabot.yml scripts/build.sh \
           scripts/security-checks.sh.md scripts/guards.dx/a.sh src/scripts/guards.d/a.sh \
           scripts/plugin-pins.md scripts/plugin-pins-report.mjs scripts/fetch.sh \
           src/.gitleaks.toml .gitleaks.toml.md docs/zizmor.yml .github/zizmor.md \
           scripts/auto-merge-paths.txt.md; do
    if grep -qiE "$RE" <<< "$p"; then bad 1 "non-gated path matched by CLAUDE_GATE_RE: $p"; fi
  done
fi
# The project's additions: one definition, a usable pattern, and its own table.
# Run together with the kit's pattern, exactly as the two jobs do.
PROJECT_RE=$(sed -n "s/^  PROJECT_GATE_RE: '\(.*\)'$/\1/p" "$AM")
if [ -z "$PROJECT_RE" ]; then
  bad 1 "PROJECT_GATE_RE is not defined (single-quoted, non-empty; '^\$' adds nothing) in the workflow env of $AM"
else
  rc=0
  grep -qiE "$PROJECT_RE" <<< "x" 2> /dev/null || rc=$?
  [ "$rc" -le 1 ] || bad 1 "PROJECT_GATE_RE is not a usable extended regular expression: $PROJECT_RE"
fi
TABLE=scripts/auto-merge-paths.txt
if [ -n "$RE" ] && [ -n "$PROJECT_RE" ] && [ -f "$TABLE" ]; then
  while read -r want p rest; do
    case "$want" in ''|'#'*) continue ;; esac
    if [ -z "$p" ] || [ -n "$rest" ]; then bad 1 "$TABLE: expected 'hold <path>' or 'pass <path>', got: $want $p $rest"; continue; fi
    got=pass
    if grep -qiE -e "$RE" -e "$PROJECT_RE" <<< "$p" 2> /dev/null; then got=hold; fi
    case "$want" in
      hold|pass) [ "$got" = "$want" ] || bad 1 "$TABLE says '$want $p' but the gate would $got it — fix PROJECT_GATE_RE or the row" ;;
      *) bad 1 "$TABLE: expected 'hold <path>' or 'pass <path>', got: $want $p" ;;
    esac
  done < "$TABLE"
fi
# One definition, at the workflow level: a job- or step-level `env:` could
# otherwise shadow it with a weaker pattern and this check would not see it.
for var in CLAUDE_GATE_RE PROJECT_GATE_RE; do
  defined=$(grep -cE "^ *$var:" "$AM" || true)
  if [ "$defined" != "1" ]; then
    bad 1 "$var is defined $defined time(s) in $AM — exactly one definition, in the workflow-level env"
  fi
done
# Every job that merges a pull request (one PUT .../pulls/N/merge call each) applies the gate.
merging=$(grep -cF 'pulls/${PR}/merge"' "$AM" || true)
gated=$(grep -cF 'grep -i -E -c -e "$CLAUDE_GATE_RE" -e "$PROJECT_GATE_RE" <<< "$PATHS"' "$AM" || true)
if [ "$merging" = "0" ] || [ "$merging" != "$gated" ]; then
  bad 1 "$merging job(s) merge but $gated apply the CLAUDE_GATE_RE and PROJECT_GATE_RE gate — every merging job must"
fi
# And every one refuses a head a CI Claude session wrote, in its job `if:`.
heads=$(grep -cE "^ +!startsWith\(github\.event\.[a-z_.]+, 'claude/issue-'\)$" "$AM" || true)
if [ "$merging" != "$heads" ]; then
  bad 1 "$merging job(s) merge but $heads refuse claude/issue-* heads — every merging job must"
fi
pass 1 "CLAUDE_GATE_RE and PROJECT_GATE_RE gate what is executed; the $merging merging job(s) apply them and refuse claude/issue-* heads"

# ── AM-4 — marking ready never merges ───────────────────────────────────────
# Held pull requests (green CI, hand merge pending; gated docs-only ones) are
# marked ready so the merge button works, and that is ALL those lines do.
# Pinned to the exact text, and every way of merging is accounted for: a merge
# can be spelled many ways, so the guard checks what the steps are, not what
# they lack.
# The one way to mark ready, and every spelling of a merge call.
READY='gh pr ready "$PR" || echo "::warning::PR #${PR}: could not mark it ready — lift draft by hand."'
MERGE_RE='pulls/[^ ]*/merge|/merges|pr merge|mergePullRequest|AutoMerge'
ready=$(awk '/- name: Mark ready \(validated head only/ {f=1; next} f && /^      - name:/ {exit} f' "$AM")
if [ -z "$ready" ] \
   || ! grep -qxF "        if: steps.find-pr.outputs.pr != '' && steps.gate.outputs.merge != ''" <<< "$ready" \
   || ! grep -qxF '          if [ "$HEAD" != "$HEAD_SHA" ]; then' <<< "$ready" \
   || ! grep -qxF "          $READY" <<< "$ready"; then
  bad 4 "promote-from-ci's 'Mark ready (validated head only, never merges)' step changed: it must only mark the validated head ready"
fi
# promote-docs hands over a gated docs-only pull request once, inside its gate
# branch. (Both jobs have such a branch: collect every one, up to its `exit 0`.)
gated_branch=$(awk '/if \[ "\$CLAUDE_FILES" != "0" \]; then/ {f=1; next} f && /^ +exit 0$/ {f=0} f' "$AM")
docs_line="            if [ \"\$NON_DOCS\" = \"0\" ]; then $READY; fi"
if [ "$(grep -cxF "$docs_line" "$AM")" != "1" ] || ! grep -qxF "$docs_line" <<< "$gated_branch"; then
  bad 4 "promote-docs must hand over a gated docs-only pull request with exactly one pinned line inside its CLAUDE_FILES branch"
fi
# Every merge call in the file (any spelling, comments excluded) is one of the
# gated REST PUTs AM-1 counts — so no ready step can merge either.
code=$(grep -vE '^[[:space:]]*#' "$AM")
calls=$(grep -ciE "$MERGE_RE" <<< "$code" || true)
counted=$(grep -cF 'pulls/${PR}/merge"' <<< "$code" || true)
if [ "$calls" != "$counted" ] || [ "$counted" != "$merging" ]; then
  bad 4 "$AM has $calls merge call(s) but $counted in the gated REST form AM-1 counts — every merge must be one of those"
fi
pass 4 "marking a pull request ready never merges it; all $calls merge call(s) are the gated ones"

# ── AM-5 — Dependabot: patch and minor merge, a major only when indirect ─────
# Runs the gate's own dependabot_verdict, extracted from the workflow, on
# commit bodies in the shapes Dependabot writes (single bump, group, docker,
# security update) and on every shape it must hold, and bump_level on a table;
# pins that the workflow defines each once, merges only on an exact `merge`
# and holds a foreign commit.
block=$(sed -n '/# >>> dependabot_verdict/,/# <<< dependabot_verdict/p' "$AM" | sed 's/^ *//')
for f in dependabot_verdict bump_level; do
  n=$(grep -c "^ *$f() {" "$AM" || true)
  [ "$n" = "1" ] || bad 5 "$AM must define $f() exactly once (found $n)"
done
if ! grep -q '^dependabot_verdict() {' <<< "$block"; then
  bad 5 "dependabot_verdict() not found between its >>> / <<< markers in $AM"
else
  eval "$block"
  am5() { # am5 <expected merge|hold> <label> <changed paths> [quiet]   (commit body on stdin)
    local got
    if [ "${4:-}" = quiet ]; then got=$(dependabot_verdict "$3" 2> /dev/null); else got=$(dependabot_verdict "$3"); fi
    case "$got" in merge) got=merge ;; *) got=hold ;; esac
    [ "$got" = "$1" ] || bad 5 "dependabot_verdict on '$2': $got, expected $1"
  }

  # An indirect dependency's major goes through outside the held paths.
  MAJOR_HOLD_RE='^mobile/'
  am5 merge 'security update, indirect, no update-type' api/package-lock.json <<'B'
Bumps [@scope/server](https://github.com/example/server) from 2.0.12 to 2.1.6.
---
updated-dependencies:
- dependency-name: "@scope/server"
  dependency-type: indirect
...
B
  am5 merge 'minor group' api/package.json <<'B'
Bumps the api-minor group with 3 updates in the /api directory:
Updates `@scope/core` from 12.0.4 to 12.3.2
Updates `@types/node` from 24.13.5 to 24.19.2
Updates `globals` from 17.12.0 to 17.14.0
---
updated-dependencies:
- dependency-name: "@scope/core"
  update-type: version-update:semver-minor
- dependency-name: "@types/node"
  update-type: version-update:semver-minor
- dependency-name: globals
  update-type: version-update:semver-minor
...
B
  am5 merge 'patch group, header line carrying links' api/package.json <<'B'
Bumps the api-patch group in /api with 3 updates: [@scope/sdk](https://github.com/example/sdk), [@scope/core](https://github.com/example/core) and [@scope/cli](https://github.com/example/cli).
Updates `@scope/sdk` from 1.32.1 to 1.32.2
Updates `@scope/core` from 12.0.3 to 12.0.5
Updates `@scope/cli` from 12.0.10 to 12.0.11
---
updated-dependencies:
- dependency-name: "@scope/sdk"
  update-type: version-update:semver-patch
- dependency-name: "@scope/core"
  update-type: version-update:semver-patch
- dependency-name: "@scope/cli"
  update-type: version-update:semver-patch
...
B
  am5 merge 'actions patch group' .github/workflows/ci.yml <<'B'
Bumps the actions-patch group with 2 updates: [actions/upload-artifact](https://github.com/actions/upload-artifact) and [actions/download-artifact](https://github.com/actions/download-artifact).
Updates `actions/upload-artifact` from 7.0.1 to 7.0.2
Updates `actions/download-artifact` from 8.0.1 to 8.0.2
---
updated-dependencies:
- dependency-name: actions/upload-artifact
  update-type: version-update:semver-patch
- dependency-name: actions/download-artifact
  update-type: version-update:semver-patch
...
B
  am5 hold 'GitHub Action minor' .github/workflows/ci.yml <<'B'
Updates `docker/login-action` from 4.6.0 to 4.7.0
---
updated-dependencies:
- dependency-name: docker/login-action
  update-type: version-update:semver-minor
...
B
  am5 hold 'major in the trailer' api/package.json <<'B'
Bumps [lib-a](https://github.com/example/lib-a) from 17.4.2 to 18.0.9.
---
updated-dependencies:
- dependency-name: lib-a
  update-type: version-update:semver-major
...
B
  am5 hold 'trailer says major, pair looks minor' api/package.json <<'B'
Bumps [x](u) from 1.2.0 to 1.3.0.
---
updated-dependencies:
- dependency-name: x
  update-type: version-update:semver-major
...
B
  am5 merge 'indirect major (security update: the only fix)' api/package-lock.json <<'B'
Bumps [lib-b](https://github.com/example/lib-b) from 9.0.5 to 11.0.1.
---
updated-dependencies:
- dependency-name: lib-b
  dependency-type: indirect
...
B
  am5 merge 'indirect major typed semver-major' api/package-lock.json <<'B'
Bumps [lib-b](https://github.com/example/lib-b) from 9.0.5 to 11.0.1.
---
updated-dependencies:
- dependency-name: lib-b
  dependency-type: indirect
  update-type: version-update:semver-major
...
B
  am5 hold 'direct major without update-type' api/package.json <<'B'
Bumps [lib-a](https://github.com/example/lib-a) from 17.4.2 to 18.0.9.
---
updated-dependencies:
- dependency-name: lib-a
  dependency-type: direct:development
...
B
  am5 hold 'indirect move to a pre-release' api/package-lock.json <<'B'
Bumps [lib-b](https://github.com/example/lib-b) from 9.0.5 to 11.0.1-rc.1.
---
updated-dependencies:
- dependency-name: lib-b
  dependency-type: indirect
...
B
  am5 hold 'indirect major touching .github/' .github/workflows/ci.yml <<'B'
Bumps [x](u) from 1.0.0 to 2.0.0.
---
updated-dependencies:
- dependency-name: x
  dependency-type: indirect
...
B
  am5 hold 'indirect major under a MAJOR_HOLD_RE path' mobile/package-lock.json <<'B'
Bumps [lib-b](u) from 9.0.5 to 11.0.1.
---
updated-dependencies:
- dependency-name: lib-b
  dependency-type: indirect
...
B
  am5 merge 'indirect 0.x minor (rated major) outside MAJOR_HOLD_RE' api/package-lock.json <<'B'
Bumps [x](u) from 0.3.1 to 0.4.0.
---
updated-dependencies:
- dependency-name: x
  dependency-type: indirect
...
B
  am5 hold 'type line outside the trailer block' api/package-lock.json <<'B'
Bumps [lib-a](u) from 17.4.2 to 18.0.9.
---
updated-dependencies:
- dependency-name: lib-a
  dependency-type: direct:development
...
  dependency-type: indirect
B
  am5 hold 'same package direct in one manifest, indirect in another' api/package-lock.json <<'B'
Updates `lib-a` from 17.4.2 to 18.0.9
Updates `lib-a` from 16.4.7 to 16.6.1
---
updated-dependencies:
- dependency-name: lib-a
  dependency-type: direct:development
- dependency-name: lib-a
  dependency-type: indirect
...
B
  am5 hold 'group: direct major next to an indirect one' api/package-lock.json <<'B'
Updates `lib-b` from 9.0.5 to 11.0.1
Updates `lib-a` from 17.4.2 to 18.0.9
---
updated-dependencies:
- dependency-name: lib-b
  dependency-type: indirect
- dependency-name: lib-a
  dependency-type: direct:production
...
B
  am5 hold '0.x minor typed semver-minor' web/package.json <<'B'
Updates `foo` from 0.3.1 to 0.4.0
---
updated-dependencies:
- dependency-name: foo
  update-type: version-update:semver-minor
...
B
  am5 hold 'group: one entry without a pair' api/package.json <<'B'
Updates `a` from 1.2.0 to 1.3.0
Updates `b` to 3.0.0
---
updated-dependencies:
- dependency-name: a
  update-type: version-update:semver-minor
- dependency-name: b
...
B
  am5 hold 'SHAs starting with the same digits' api/package.json <<'B'
Bumps foo from 1a2b3c4 to 1f0e9d8.
---
updated-dependencies:
- dependency-name: foo
...
B
  am5 hold 'untyped Action minor (security update shape)' .github/workflows/ci.yml <<'B'
Bumps [docker/login-action](https://github.com/docker/login-action) from 4.6.0 to 4.7.0.
---
updated-dependencies:
- dependency-name: docker/login-action
  dependency-type: direct:production
...
B
  am5 hold 'duplicate pair standing in for an entry without one' api/package-lock.json <<'B'
Updates `a` from 1.0.0 to 1.0.1
Updates `a` from 2.0.0 to 2.0.1
Updates the requirements on [b](u) to permit the latest version.
---
updated-dependencies:
- dependency-name: a
- dependency-name: b
...
B
  am5 hold '0.0.x patch' api/package.json <<'B'
Bumps [foo](u) from 0.0.3 to 0.0.4.
---
updated-dependencies:
- dependency-name: foo
  update-type: version-update:semver-patch
...
B
  am5 hold 'stable to pre-release' api/package.json <<'B'
Bumps [foo](u) from 1.2.3 to 1.3.0-beta.1.
---
updated-dependencies:
- dependency-name: foo
  update-type: version-update:semver-minor
...
B
  am5 merge 'docker base image minor' api/Dockerfile <<'B'
Bumps node from 24.11-alpine to 24.12-alpine.
---
updated-dependencies:
- dependency-name: node
  update-type: version-update:semver-minor
...
B
  am5 hold 'no trailer' api/package.json <<'B'
Bumps [x](u) from 1.0.0 to 1.0.1.
B
  am5 hold 'empty body' api/package.json < /dev/null

  # MAJOR_HOLD_RE decides the indirect major and nothing else; whatever cannot
  # be read as "no path matched" holds.
  indirect_major() { # indirect_major <expected> <label> [quiet]
    am5 "$1" "$2" api/package-lock.json "${3:-}" <<'B'
Bumps [lib-b](https://github.com/example/lib-b) from 9.0.5 to 11.0.1.
---
updated-dependencies:
- dependency-name: lib-b
  dependency-type: indirect
...
B
  }
  MAJOR_HOLD_RE='.';  indirect_major hold 'indirect major, MAJOR_HOLD_RE as shipped (every path)'
  MAJOR_HOLD_RE='^$'; indirect_major merge 'indirect major, MAJOR_HOLD_RE holding nothing beyond .github/'
  MAJOR_HOLD_RE='(';  indirect_major hold 'indirect major, unusable MAJOR_HOLD_RE' quiet
  MAJOR_HOLD_RE='';   indirect_major hold 'indirect major, empty MAJOR_HOLD_RE'
  unset MAJOR_HOLD_RE; indirect_major hold 'indirect major, MAJOR_HOLD_RE unset'
  MAJOR_HOLD_RE='^mobile/'
  am5 hold 'indirect major with no changed path to judge by' '' <<'B'
Bumps [lib-b](https://github.com/example/lib-b) from 9.0.5 to 11.0.1.
---
updated-dependencies:
- dependency-name: lib-b
  dependency-type: indirect
...
B
  MAJOR_HOLD_RE='.'
  am5 merge 'indirect minor, MAJOR_HOLD_RE as shipped' api/package-lock.json <<'B'
Bumps [@scope/server](https://github.com/example/server) from 2.0.12 to 2.1.6.
---
updated-dependencies:
- dependency-name: "@scope/server"
  dependency-type: indirect
...
B

  while read -r from to want; do
    got=$(bump_level "$from" "$to")
    [ "$got" = "$want" ] || bad 5 "bump_level $from -> $to: $got, expected $want"
  done <<'TABLE'
2.0.12 2.1.6 minor
1.2.3 1.2.4 patch
v4.6.0 v4.7.0 minor
24-alpine 24.12-alpine minor
1.2.3-rc.1 1.2.3 patch
17.4.2 18.0.9 major
0.3.1 0.4.0 major
0.0.3 0.0.4 major
0.3.1 0.3.2 patch
1.2.3 1.3.0-beta.1 prerelease
de7274f 77dd5b2 bad
1a2b3c4 1f0e9d8 bad
`1.2.3` `1.2.4` bad
1.2.3 - bad
TABLE
fi
if ! grep -qF 'VERDICT=$(dependabot_verdict "$PATHS" <<< "$MSGS")' "$AM" \
   || ! grep -qF 'if [ "$VERDICT" != merge ]; then' "$AM"; then
  bad 5 "the gate must call dependabot_verdict and merge only on an exact 'merge'"
fi
if ! grep -qF "if grep -qvxF 'dependabot[bot]' <<< \"\$AUTHORS\"; then" "$AM"; then
  bad 5 "the gate must hold a Dependabot pull request carrying a commit another author pushed"
fi
# The workflow sets where a major is held, as a usable pattern.
HOLD=$(sed -n "s/^  MAJOR_HOLD_RE: '\(.*\)'$/\1/p" "$AM")
if [ -z "$HOLD" ]; then
  bad 5 "MAJOR_HOLD_RE is not defined (single-quoted, non-empty) in the workflow env of $AM"
else
  rc=0
  grep -qE "$HOLD" <<< "x" 2> /dev/null || rc=$?
  [ "$rc" -le 1 ] || bad 5 "MAJOR_HOLD_RE is not a usable extended regular expression: $HOLD"
fi
# An indirect major may merge because only a security update touches an
# indirect dependency: version updates stay on their default (direct
# dependencies), so dependabot.yml carries no `allow` key at all, in any YAML
# spelling, and no second config file could override it. With no dependabot.yml
# there are no version updates: every Dependabot pull request is a security one.
# Comments stripped, the bare word `allow` anywhere (quoted, flow, `? allow`).
if [ -f .github/dependabot.yml ]; then
  config=$(sed 's/#.*$//' .github/dependabot.yml)
  if grep -qiwE 'allow' <<< "$config"; then
    bad 5 ".github/dependabot.yml must not set 'allow': the gate reads a 'dependency-type: indirect' entry as a security update"
  fi
  updates=$(grep -cE '^[[:space:]]*-[[:space:]]*package-ecosystem:' <<< "$config" || true)
  cooldowns=$(grep -cE '^[[:space:]]*cooldown:' <<< "$config" || true)
  if [ "$updates" != "$cooldowns" ]; then
    note "AM-5: .github/dependabot.yml has $updates update entr(ies) and $cooldowns cooldown block(s) — without a cooldown, a version published minutes ago merges unattended"
  fi
fi
if [ -e .github/dependabot.yaml ]; then
  bad 5 ".github/dependabot.yaml must not exist: .github/dependabot.yml is the one config AM-5 checks"
fi
pass 5 "Dependabot: patch and minor merge, majors and unreadable bumps hold, foreign commits hold"

# ── AM-6 — the merge is the commit CI validated, of one CI workflow ──────────
# workflow_run fires once per listed workflow: two names would merge as soon as
# either is green. One name, in the form the installer writes.
waited=$(grep -cE '^    workflows: \["[^",]+"\]$' "$AM" || true)
listed=$(grep -cE '^ +workflows:' "$AM" || true)
if [ "$waited" != "1" ] || [ "$listed" != "1" ]; then
  bad 6 "workflow_run must wait for exactly one workflow, written workflows: [\"<name>\"] — a second name merges on whichever is green first"
fi
# The pull request is the one whose head IS the validated SHA (a `sha:` search
# also returns stacked and sibling pull requests)…
if ! grep -qF 'select(.headRefOid == $ENV.HEAD_SHA)' "$AM"; then
  bad 6 "find-pr must keep only the pull request whose head is the CI-validated SHA (select(.headRefOid == \$ENV.HEAD_SHA))"
fi
# …every merge call passes it, so a head pushed since is refused (409)…
pinned=$(grep -cF -- '-f merge_method="$method" -f sha="$HEAD_SHA"' "$AM" || true)
if [ "$pinned" != "$merging" ]; then
  bad 6 "$merging merge call(s) but $pinned pass sha=\"\$HEAD_SHA\" — every merge must be pinned to the validated head"
fi
# …and it is the event's SHA, never the pull request's current head.
foreign=$(grep -E '^ +HEAD_SHA: ' "$AM" | grep -cvE '^ +HEAD_SHA: \$\{\{ github\.event\.(workflow_run\.head_sha|pull_request\.head\.sha) \}\}$' || true)
if [ "$foreign" != "0" ]; then
  bad 6 "HEAD_SHA must come from the triggering event (workflow_run.head_sha or pull_request.head.sha) in every step"
fi
pass 6 "the merge is pinned to the SHA of the event, for the one workflow waited for"

# ── AM-7 — the gate judges the range that is merged ─────────────────────────
# The merge is pinned to HEAD_SHA; the gate must read the same thing. A listing
# of the pull request's CURRENT files or commits can be made to show another
# diff for an instant (a head or a base moved and put back). So: no such
# listing, one read of the immutable range per merging job, a head check and a
# base re-check in each, and the base taken from the event or from the gate.
live=$(grep -cE 'pulls/\$\{?PR\}?/(files|commits)' "$AM" || true)
if [ "$live" != "0" ]; then
  bad 7 "$live listing(s) of the pull request's current files or commits — the gate must read compare/\${BASE_SHA}...\${HEAD_SHA}"
fi
ranges=$(grep -cF 'compare/${BASE_SHA}...${HEAD_SHA}"' "$AM" || true)
if [ "$ranges" != "$merging" ]; then
  bad 7 "$merging merging job(s) but $ranges read the immutable range compare/\${BASE_SHA}...\${HEAD_SHA}"
fi
heads_checked=$(grep -cF 'if [ "$PR_HEAD" != "$HEAD_SHA" ]' "$AM" || true)
if [ "$heads_checked" != "$merging" ]; then
  bad 7 "$merging merging job(s) but $heads_checked check that the pull request's head is still the event's before reading its file count"
fi
# A read that fails must fail the job. Fed straight into `read` through a
# here-string, a failing call leaves the variables empty, the head check
# reports "head moved" and the job ends green: no call inside a here-string,
# and each merging job stops on an empty head before comparing it.
swallowed=$(grep -cE '<<< *"\$\((gh|curl) ' <<< "$code" || true) # $code: the workflow without its comment lines (AM-4)
if [ "$swallowed" != "0" ]; then
  bad 7 "$swallowed API call(s) fed straight into a here-string — a failed call there is silent; assign first, then check"
fi
unread=$(awk '/^          if \[ -z "\$PR_HEAD" \]; then$/ { armed = 1; next } armed && /^            exit 1$/ { n++ } /^          fi$/ { armed = 0 } END { print n + 0 }' "$AM")
if [ "$unread" != "$merging" ]; then
  bad 7 "$merging merging job(s) but $unread fail on a pull request that could not be read — an empty head must exit 1, not pass for a moved head"
fi
rechecked=$(grep -cxF '          if [ -z "$BASE_REF" ] || [ "$NOW_BASE" != "$BASE_REF" ]; then' "$AM" || true)
if [ "$rechecked" != "$merging" ]; then
  bad 7 "$merging merging job(s) but $rechecked re-read the base branch right before merging"
fi
foreign_base=$(grep -E '^ +BASE_(SHA|REF): ' "$AM" | grep -cvE '^ +(BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \}\}|BASE_REF: \$\{\{ (github\.event\.pull_request\.base\.ref|steps\.gate\.outputs\.base_ref) \}\})$' || true)
if [ "$foreign_base" != "0" ]; then
  bad 7 "BASE_SHA / BASE_REF must come from the triggering event or from the gate step's output"
fi
pass 7 "the gate reads the immutable range that is merged, the base is re-read before each merge, and a failed read fails the job"

# Advisory: nothing merges code until the workflow waited for exists.
ci_name=$(sed -n 's/^    workflows: \["\(.*\)"]$/\1/p' "$AM")
if [ -n "$ci_name" ]; then
  found=0
  for wf in .github/workflows/*.yml .github/workflows/*.yaml; do
    [ -f "$wf" ] || continue
    name=$(sed -n 's/^name:[[:space:]]*//p' "$wf" | head -n 1 | sed -e 's/[[:space:]]*#.*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/")
    if [ "$name" = "$ci_name" ]; then found=1; fi
  done
  if [ "$found" = 0 ]; then
    note "no workflow named \"$ci_name\" under .github/workflows/ — until one exists, only docs-only pull requests are merged"
  fi
fi

finish
