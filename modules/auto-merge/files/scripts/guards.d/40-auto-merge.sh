#!/usr/bin/env bash
# AM-1, AM-4, AM-5, AM-6, AM-7, AM-8, AM-9, AM-10 — invariants of .github/workflows/auto-merge.yml
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
#         from one compare/<base branch's tip>...<validated head> per merging
#         job, the tip read by its full ref and used nowhere else, never from
#         the pull request's current state nor from its stored base.sha; a
#         listing of 300 files holds whatever the count. Before each merge
#         call, retries included, the pull request, the tip and, when the tip
#         moved, the merge base are read again: a merge this workflow's token
#         made goes to the check (AM-10), a hand merge is left alone, a
#         retarget or a moved merge base stops the merge; after the last call
#         the pull request is read once more.
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
#   AM-6  the merge is the commit CI validated: the pull request is selected
#         by its head SHA, every merge call passes that SHA, and the SHA comes
#         from the triggering event — a CI run's head, or the commit a review
#         run names in its run name, a review run being accepted only when
#         workflow_run started it from the review's file. Two workflows are
#         waited for, the CI one and the automated review, and nothing merges
#         before the sign-off step has read both: its signoff_state, extracted
#         from between its markers, is run on tables of runs.
#   AM-9  the CI workflow waited for lists `edited` among its pull_request
#         types, so a pull request retargeted to the default branch is tested
#         against it (a heuristic on the `types:` line: a workflow written
#         another way fails until it says it plainly).
#   AM-8  tests that get weaker. Green means merged, and green is what the
#         tests say, so a pull request that deletes, renames or rewrites lines
#         of an existing file under TEST_HOLD_RE is held. The workflow's own
#         jq selection is extracted and run on the file shapes the compare API
#         returns (it needs jq, as the workflow does); the pattern is defined
#         once, every merging job applies it, and the `test` / `not-test`
#         rows of scripts/auto-merge-paths.txt are run on it.
#   AM-10 what the merge wrote is judged again. The gate lists the changes
#         since one merge base of the tip and the head; the merge writes what
#         GitHub's merge engine computes. Right after each merge step, a step
#         lists the commit the merge created against its first parent and
#         runs the gate's rules on it (held paths, weakened tests, and outside
#         the docs for the docs job): red when anything matches, when the
#         listing is cut short or cannot be read. Its run block is pinned,
#         the same in both jobs, and the merge steps hand it the commit. No
#         continue-on-error, defaults, shell, GITHUB_ENV or GITHUB_PATH in
#         the file, and no ${{ }} inside a run: script (comments included).
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
  # entry), CLAUDE.md / CLAUDE.local.md / AGENTS.md anywhere, case variants (a
  # case-insensitive file system folds them), the git hooks directory, a
  # project MCP config, the other files a Claude CI action reads as
  # configuration, and what runs Claude in CI or enforces all this.
  for p in CLAUDE.md claude.md sub/CLAUDE.md CLAUDE.local.md \
           AGENTS.md agents.md sub/AGENTS.md docs/Agents.md \
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
           scripts/weekly-digest.mjs scripts/weekly-digest.test.mjs \
           scripts/weekly-digest.config.mjs scripts/audit-gate.mjs \
           scripts/audit-gate.test.mjs scripts/audit-allowlist.json \
           scripts/parallel-sessions.sh Scripts/Audit-Allowlist.JSON \
           scripts/eco-design-audit.mjs scripts/eco-design-audit.test.mjs \
           scripts/eco-design.config.json Scripts/Eco-Design.Config.JSON \
           scripts/fetch-pinned-release.sh .gitleaks.toml .gitleaksignore \
           .gitleaks.json .GITLEAKS.JSON zizmor.yml zizmor.yaml \
           .npmrc packages/api/.npmrc \
           .github/zizmor.yml .github/zizmor.yaml scripts/auto-merge-paths.txt \
           SECURITY_REVIEW.md SECURITY_REVIEW_2026-11.md security_review.md \
           docs/conventions/auto-merge-policy.md docs/conventions/new-rule.md \
           docs/Conventions/agent-bash-guard.md; do
    if ! grep -qiE "$RE" <<< "$p"; then bad 1 "gated path NOT matched by CLAUDE_GATE_RE: $p"; fi
  done
  # Must not be gated: ordinary docs, code and scripts.
  for p in README.md docs/foo.md docs/conventionsx/a.md src/docs/conventions/a.md x/claudette.md \
           docs/my-agents.md docs/agents.mdx AGENTS.md.txt docs/adr/ADR-001.md \
           src/claude.service.ts .gitignore LICENSE src/claude/x.ts \
           .github/workflows/ci.yml .github/dependabot.yml scripts/build.sh \
           scripts/security-checks.sh.md scripts/guards.dx/a.sh src/scripts/guards.d/a.sh \
           scripts/plugin-pins.md scripts/plugin-pins-report.mjs scripts/fetch.sh \
           scripts/weekly-digest-notes.md scripts/weekly-digest.mjs.md \
           scripts/audit-gate.md scripts/audit-allowlist.json.example \
           scripts/parallel-sessions.md src/scripts/audit-gate.mjs \
           scripts/eco-design-audit.md scripts/eco-design.config.json.example \
           src/scripts/eco-design-audit.mjs scripts/eco-design-audit-notes.md \
           src/.gitleaks.toml .gitleaks.toml.md docs/zizmor.yml .github/zizmor.md \
           src/.gitleaks.json .gitleaks.json.md src/zizmor.yml zizmor.yml.md \
           .npmrc.example docs/npmrc.md \
           scripts/auto-merge-paths.txt.md SECURITY.md docs/SECURITY_REVIEW.md \
           SECURITY_REVIEW.md.txt; do
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
    if [ -z "$p" ] || [ -n "$rest" ]; then bad 1 "$TABLE: expected '<hold|pass|test|not-test> <path>', got: $want $p $rest"; continue; fi
    got=pass
    if grep -qiE -e "$RE" -e "$PROJECT_RE" <<< "$p" 2> /dev/null; then got=hold; fi
    case "$want" in
      hold|pass) [ "$got" = "$want" ] || bad 1 "$TABLE says '$want $p' but the gate would $got it — fix PROJECT_GATE_RE or the row" ;;
      test|not-test) ;; # TEST_HOLD_RE rows: AM-8
      *) bad 1 "$TABLE: expected 'hold <path>', 'pass <path>', 'test <path>' or 'not-test <path>', got: $want $p" ;;
    esac
  done < "$TABLE"
fi
# One definition, at the workflow level: a job- or step-level `env:` could
# otherwise shadow it with a weaker pattern and this check would not see it.
for var in CLAUDE_GATE_RE PROJECT_GATE_RE; do # TEST_HOLD_RE: AM-8
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
heads=$(grep -cE "^ +!startsWith\(github\.event\.[a-z_.]+, 'claude/issue-'\)( &&)?$" "$AM" || true)
rework_heads=$(grep -cE "^ +!startsWith\(github\.event\.[a-z_.]+, 'claude/rework-'\)( &&)?$" "$AM" || true)
[ "$rework_heads" = "$merging" ] || bad 1 "$merging job(s) merge but $rework_heads refuse claude/rework-* heads — every merging job must"
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

# ── AM-6 — the merge is the commit CI validated, after both sign-offs ────────
# workflow_run fires once per listed workflow, and on whichever finishes: so
# exactly the CI workflow and the review are listed, and the gate (which every
# merge sits behind) runs only once the sign-off step has said ok. A third name
# would add a trigger nothing checks.
waited=$(grep -cE '^    workflows: \["[^",]+", "Claude review"\]$' "$AM" || true)
listed=$(grep -cE '^ +workflows:' "$AM" || true)
if [ "$waited" != "1" ] || [ "$listed" != "1" ]; then
  bad 6 "workflow_run must wait for exactly two workflows, written workflows: [\"<CI name>\", \"Claude review\"]"
fi
if ! grep -qxF "        if: steps.find-pr.outputs.pr != '' && steps.signoff.outputs.ok == 'true'" "$AM"; then
  bad 6 "the merge gate must run only once the sign-off step said ok (if: steps.find-pr.outputs.pr != '' && steps.signoff.outputs.ok == 'true')"
fi
okline=$(grep -cF 'echo "ok=true" >> "$GITHUB_OUTPUT"' "$AM" || true)
if [ "$okline" != "1" ]; then
  bad 6 "the sign-off step must write ok=true in exactly one place (found $okline)"
fi
if ! grep -qxF "          CI_STATE=\$(signoff_state '.name == \$ENV.CI_NAME' rerun-ok <<< \"\$CI_RUNS\")" "$AM" \
   || ! grep -qxF "            REVIEW_STATE=\$(signoff_state '.path == \$ENV.REVIEW_PATH' first-attempt <<< \"\$REVIEW_RUNS\")" "$AM" \
   || ! grep -qF "actions/workflows/claude-review.yml/runs?event=workflow_run&per_page=100" "$AM" \
   || ! grep -qF 'select(.display_title == ("Claude review of " + $ENV.HEAD_SHA))' "$AM" \
   || ! grep -qxF "          export REVIEW_PATH=.github/workflows/claude-review.yml" "$AM" \
   || ! grep -qxF "            ok|skipped) echo \"ok=true\" >> \"\$GITHUB_OUTPUT\" ;;" "$AM"; then
  bad 6 "the sign-off step must judge every CI run by name, every review run started by workflow_run and naming the commit at its first attempt, and say ok only for ok or skipped"
fi
if ! grep -qxF "      (github.event.workflow_run.event == 'pull_request' || (github.event.workflow_run.event == 'workflow_run' && github.event.workflow_run.path == '.github/workflows/claude-review.yml')) &&" "$AM" \
   || ! grep -qxF '              if ! [[ "$RUN_TITLE" =~ ^Claude\ review\ of\ [0-9a-f]{40}$ ]]; then' "$AM" \
   || ! grep -qxF '          RUN_TITLE: ${{ github.event.workflow_run.display_title }}' "$AM" \
   || ! grep -qxF '          if [[ "$HEAD_REF" == claude/issue-* || "$HEAD_REF" == claude/rework-* ]]; then' "$AM"; then
  bad 6 "a review run is accepted only when started by workflow_run from .github/workflows/claude-review.yml, its commit is read from its run name, and the pull request's own claude/issue-* head is refused"
fi
# When the review is required, and that it cannot be switched off from the
# pull request or by an outage: its file is looked up on the default branch,
# only a 404 means "not installed", any other failure stops the job, and only
# Dependabot is exempt. Each line pinned; the counts keep a second assignment
# from undoing them.
for line in \
  '          if OUT=$(gh api "repos/${GITHUB_REPOSITORY}/contents/${REVIEW_PATH}?ref=${DEFAULT_BRANCH}" --jq '"'"'.sha'"'"' 2>&1); then' \
  '            REVIEW=required' \
  '              *"(HTTP 404)"*) REVIEW=none ;;' \
  '          if [ "$AUTHOR" = "dependabot[bot]" ] || [ "$AUTHOR" = "app/dependabot" ] || [ "$AUTHOR" = "dependabot" ]; then' \
  '          REVIEW_STATE=skipped' \
  '          if [ "$REVIEW" = required ]; then' \
  '          if [ "$(jq -r '"'"'.total'"'"' <<< "$CI_RUNS")" -gt 100 ]; then' \
  "      group: auto-merge-\${{ github.event.workflow_run.event == 'workflow_run' && github.event.workflow_run.display_title || format('Claude review of {0}', github.event.workflow_run.head_sha) }}" \
  '          FOUND=$(gh pr list --search "sha:$HEAD_SHA" --state open --base "$DEFAULT_BRANCH" --json number,headRefOid,headRefName \' \
  '          if [ "$COUNT" != "1" ]; then' \
  '          if [ "$BASE_REF" != "$DEFAULT_BRANCH" ]; then'; do
  grep -qxF -- "$line" "$AM" || bad 6 "sign-off line missing or changed: $line"
done
if ! grep -qF '              *) echo "$OUT"; echo "::error::Could not tell whether ${REVIEW_PATH} exists' "$AM"; then
  bad 6 "a failed lookup of the review file must stop the job, never read as \"not installed\""
fi
n_req=$(grep -cE 'REVIEW=required' "$AM" || true); n_none=$(grep -cE 'REVIEW=none' "$AM" || true); n_skip=$(grep -cE 'REVIEW_STATE=skipped' "$AM" || true)
if [ "$n_req" != "1" ] || [ "$n_none" != "2" ] || [ "$n_skip" != "1" ]; then
  bad 6 "REVIEW=required once, REVIEW=none twice (404, Dependabot), REVIEW_STATE=skipped once — found $n_req, $n_none, $n_skip"
fi
if ! grep -qxF '          if [ "$CI_STATE" != ok ]; then' "$AM"; then
  bad 6 "the sign-off step must stop unless CI is ok"
fi
sblock=$(sed -n '/# >>> signoff_state/,/# <<< signoff_state/p' "$AM" | sed 's/^ *//')
if [ "$(grep -c '^ *signoff_state() {' "$AM" || true)" != "1" ] || ! grep -q '^signoff_state() {' <<< "$sblock"; then
  bad 6 "signoff_state() must be defined once, between its >>> / <<< markers"
elif ! command -v jq > /dev/null 2>&1; then
  if [ -n "${CI:-}" ]; then bad 6 "jq is needed to run signoff_state"; else note "AM-6: jq not found — signoff_state not run"; fi
else
  eval "$sblock"
  am6() { # am6 <expected> <label> <rerun-ok|first-attempt> <runs: name|path|run_number|run_attempt|status|conclusion, one per line>
    local got runs filter
    runs=$(jq -Rn '{runs: [inputs | split("|") | {name: .[0], path: .[1], run_number: (.[2] | tonumber), run_attempt: (.[3] | tonumber), status: .[4], conclusion: (if .[5] == "" then null else .[5] end)}]}' <<< "$4")
    if [ "$3" = rerun-ok ]; then filter='.name == $ENV.CI_NAME'; else filter='.path == $ENV.REVIEW_PATH'; fi
    got=$(CI_NAME=CI REVIEW_PATH=.github/workflows/claude-review.yml signoff_state "$filter" "$3" <<< "$runs")
    [ "$got" = "$1" ] || bad 6 "signoff_state on '$2': $got, expected $1"
  }
  ci=.github/workflows/ci.yml; rv=.github/workflows/claude-review.yml
  am6 ok      'CI green'                       rerun-ok "CI|$ci|4|1|completed|success"
  am6 pending 'CI running'                     rerun-ok "CI|$ci|4|1|in_progress|"
  am6 none    'no CI run'                      rerun-ok "Claude review|$rv|2|1|completed|success"
  am6 ok      'CI re-run attempt'              rerun-ok "CI|$ci|4|2|completed|success"
  am6 ok      'two green CI runs'              rerun-ok "$(printf 'CI|%s|3|1|completed|success\nCI|%s|4|1|completed|success' $ci $ci)"
  am6 red     'a later green run cannot cover' rerun-ok "$(printf 'CI|%s|3|1|completed|failure\nCI|%s|4|1|completed|success' $ci $ci)"
  am6 red     'a borrowed name cannot cover'   rerun-ok "$(printf 'CI|%s|4|1|completed|failure\nCI|.github/workflows/fake.yml|9|1|completed|success' $ci)"
  am6 ok      'review green'                   first-attempt "Claude review|$rv|2|1|completed|success"
  am6 red     'review held'                    first-attempt "Claude review|$rv|2|1|completed|failure"
  am6 red     'review cancelled'               first-attempt "Claude review|$rv|2|1|completed|cancelled"
  am6 pending 'review running'                 first-attempt "Claude review|$rv|2|1|queued|"
  am6 none    'review by name, other file'     first-attempt "Claude review|.github/workflows/fake.yml|2|1|completed|success"
  am6 red     'a hold, then a pass'            first-attempt "$(printf 'Claude review|%s|2|1|completed|failure\nClaude review|%s|3|1|completed|success' $rv $rv)"
  am6 red     'a review re-run until pass'     first-attempt "Claude review|$rv|2|2|completed|success"
  am6 red     'a review re-run, in flight'     first-attempt "Claude review|$rv|2|2|in_progress|"
  am6 red     'an unknown mode is strict'      strict "Claude review|$rv|2|2|completed|success"
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
foreign=$(grep -E '^ +HEAD_SHA: ' "$AM" | grep -cvE '^ +HEAD_SHA: \$\{\{ (steps\.event\.outputs\.head_sha|github\.event\.pull_request\.head\.sha) \}\}$' || true)
if [ "$foreign" != "0" ]; then
  bad 6 "HEAD_SHA must come from the triggering event (the 'Commit to judge' step, or pull_request.head.sha) in every step"
fi
if ! grep -qxF '          RUN_HEAD: ${{ github.event.workflow_run.head_sha }}' "$AM"; then
  bad 6 "the 'Commit to judge' step must read a CI run's commit from workflow_run.head_sha"
fi
pass 6 "the merge is pinned to the SHA of the event, once CI and the review have both signed off"

# ── AM-7 — the gate judges the range that is merged ─────────────────────────
# The merge is pinned to HEAD_SHA; the gate must read the same thing. A listing
# of the pull request's CURRENT files or commits can be made to show another
# diff for an instant (a head or a base moved and put back). So: no such
# listing, one read of the immutable range per merging job, a head check and a
# base re-check in each, and the base branch taken from the event or from the
# gate. The range starts at the base branch's tip, read by its full ref
# (git/ref/heads/…, which no tag can answer), never at the pull request's
# base.sha: GitHub sets that one when the pull request is opened and does not
# move it with the branch, and the squash applies the head's changes since its
# merge base with the current tip — a branch the head had merged, landed since,
# moves that merge base, and a held path the merge changes back would go
# unlisted. An unreadable tip fails.
live=$(grep -cE 'pulls/\$\{?PR\}?/(files|commits)' "$AM" || true)
if [ "$live" != "0" ]; then
  bad 7 "$live listing(s) of the pull request's current files or commits — the gate must read compare/\${TIP}...\${HEAD_SHA}"
fi
# The listing line, its rows and their count, each written exactly so, once per
# merging job: the read and the check of the tip are pinned below the same way.
ranges=$(grep -cxF '          RANGE=$(gh api "repos/${GITHUB_REPOSITORY}/compare/${TIP}...${HEAD_SHA}" \' <<< "$code" || true)
if [ "$ranges" != "$merging" ]; then
  bad 7 "$merging merging job(s) but $ranges read the immutable range on the pinned line RANGE=\$(gh api \"repos/\${GITHUB_REPOSITORY}/compare/\${TIP}...\${HEAD_SHA}\" \\"
fi
rows=$(grep -cxF "          ROWS=\$(jq -r '.files[] | @tsv' <<< \"\$RANGE\")" <<< "$code" || true)
counted=$(grep -cxF '          LISTED=$(grep -c . <<< "$ROWS" || true)' <<< "$code" || true)
if [ "$rows" != "$merging" ] || [ "$counted" != "$merging" ]; then
  bad 7 "$merging merging job(s) but $rows take their rows from the range and $counted count them on the pinned lines"
fi
# Counted on the jobs' code only: the patterns of the workflow-level env are the
# project's values (--set), and may name anything. A message or a comment at
# the end of a code line counts.
jobs_code=$(sed -n '/^jobs:/,$p' "$AM" | grep -vE '^[[:space:]]*#')
# Three compare calls per merging job: the gate's listing from the tip, the
# merge base read again before a merge call when the tip moved, and the listing
# of what the merge wrote (AM-10, pinned there). The tip named on four lines of
# each (its read, its check, the listing, and its hand-over to the merge loop:
# the gate's output in promote-from-ci, the comparison before each merge call
# in promote-docs; all pinned), so that no other line takes it again — from the
# pull request's base object, an env value or another variable; and the rows
# and their count assigned on their pinned lines only.
compares=$(grep -o 'compare/' <<< "$jobs_code" | grep -c . || true)
if [ "$compares" != "$((3 * merging))" ]; then
  bad 7 "$compares compare call(s) in the jobs for $merging merging job(s) — per job, one listing from the tip, one read of the merge base before a merge call, one listing of what the merge wrote (AM-10)"
fi
tip_lines=$(grep -cE '(^|[^A-Za-z0-9_])TIP([^A-Za-z0-9_]|$)' <<< "$jobs_code" || true)
if [ "$tip_lines" != "$((4 * merging))" ]; then
  bad 7 "$tip_lines code line(s) of the jobs name TIP, $((4 * merging)) expected — the tip is read once per merging job, by its full ref, and named only by its check, the listing and its hand-over to the merge loop (a message or a comment on a code line counts)"
fi
# The gate hands the tip and the merge base it judged to the merge step, each on
# one pinned line; the merge step receives them on one pinned env line each, and
# names them nowhere but in its comparisons — no line takes them again. The same
# for the merge base in the gates, and for the values read before each call.
names() { grep -cE "(^|[^A-Za-z0-9_])$1([^A-Za-z0-9_]|\$)" <<< "$jobs_code" || true; }
if [ "$(grep -cxF '          echo "tip=${TIP}" >> "$GITHUB_OUTPUT"' <<< "$jobs_code" || true)" != "1" ] \
   || [ "$(grep -cxF '          echo "merge_base=${MB}" >> "$GITHUB_OUTPUT"' <<< "$jobs_code" || true)" != "1" ] \
   || [ "$(grep -cE '^ +[A-Z_]*(TIP|MB): ' "$AM" || true)" != "2" ] \
   || ! grep -qxF '          GATE_TIP: ${{ steps.gate.outputs.tip }}' "$AM" \
   || ! grep -qxF '          GATE_MB: ${{ steps.gate.outputs.merge_base }}' "$AM"; then
  bad 7 "the gate hands the tip and the merge base it judged to the merge step on one pinned line each (echo \"tip=\${TIP}\", echo \"merge_base=\${MB}\" >> \"\$GITHUB_OUTPUT\"; GATE_TIP: \${{ steps.gate.outputs.tip }}, GATE_MB: \${{ steps.gate.outputs.merge_base }}), and no other env value names a tip or a merge base"
fi
counts="$(names GATE_TIP) $(names GATE_MB) $(names MB) $(names NOW_TIP) $(names NOW_MB) $(names STATE) $(names NOW_MERGED) $(names NOW_COMMIT) $(names NOW_BY)"
if [ "$counts" != "2 2 $((3 * merging)) $((4 * merging)) $((4 * merging)) $((6 * merging)) $((4 * merging)) $((4 * merging)) $((4 * merging))" ]; then
  bad 7 "lines naming GATE_TIP GATE_MB MB NOW_TIP NOW_MB STATE NOW_MERGED NOW_COMMIT NOW_BY: $counts — each is assigned and compared on its pinned lines only"
fi
mbs=$(grep -cxF "          MB=\$(jq -r '.base' <<< \"\$RANGE\")" <<< "$jobs_code" || true)
mb_held=$(awk '/^          if ! \[\[ "\$MB" =~ \^\[0-9a-f\]\{40,64\}\$ \]\]; then$/ { armed = 1; regions++; next }
  armed && /^          fi$/ { armed = 0; next }
  armed && /^            exit 0$/ { exits++; next }
  armed && /^            echo "::notice::/ { next }
  armed && /^            echo "merge=false" >> "\$GITHUB_OUTPUT"$/ { next }
  armed { other++ }
  END { print regions + 0, exits + 0, other + 0 }' "$AM")
based=$(grep -cF -- "--jq '{base: (.merge_base_commit.sha // \"\")," <<< "$jobs_code" || true)
if [ "$mbs" != "$merging" ] || [ "$mb_held" != "$merging $merging 0" ] || [ "$based" != "$merging" ]; then
  bad 7 "each gate reads the merge base of its range on pinned lines, and holds when it is not a commit (found: $mbs reads, $based listings asking for it, branches, exits, other lines = $mb_held)"
fi
# Before each merge call, retries included: the pull request read again (merged
# already: its commit handed to the check; retargeted: stop), the tip read again
# and, when it moved, the merge base: moved, stop; unreadable, fail. From the
# loop's head to the merge call, nothing else runs: comments, blank lines and
# plain messages aside, each job's lines are exactly these.
pre_put=$(awk '/^ *for method in squash merge; do$/ { on = 1; print "@@" }
  on && /^ *if OUT=\$\(gh api --method PUT / { on = 0 }
  on { sub(/^ */, ""); print }' "$AM" \
  | grep -vE '^(#|$)' | grep -vE '^echo "([^"$`\\]|\$\{[A-Za-z_][A-Za-z0-9_]*(:[0-9]+:[0-9]+)?\})*"$' || true)
STATE_READ='STATE=$(gh api "repos/${GITHUB_REPOSITORY}/pulls/${PR}" --jq '"'"'[.base.ref, (.merged | tostring), (.merge_commit_sha // ""), (.merged_by.login // "")] | @tsv'"'"') || STATE=""'
STATE_SPLIT='IFS=$'"'"'\t'"'"' read -r NOW_BASE NOW_MERGED NOW_COMMIT NOW_BY <<< "$STATE"'
before_call() { # before_call <the variable holding the tip the gate judged> <the one holding its merge base>
  printf '%s\n' '@@' 'for method in squash merge; do' "$STATE_READ" \
    'if [ -z "$STATE" ]; then' 'exit 1' 'fi' "$STATE_SPLIT" \
    'if [ "$NOW_MERGED" = "true" ]; then' 'if [ "$NOW_BY" != "github-actions[bot]" ]; then' 'exit 0' 'fi' \
    'echo "merged=true" >> "$GITHUB_OUTPUT"' 'echo "sha=${NOW_COMMIT}" >> "$GITHUB_OUTPUT"' 'exit 0' 'fi' \
    'if [ -z "$BASE_REF" ] || [ "$NOW_BASE" != "$BASE_REF" ]; then' 'exit 0' 'fi' \
    'NOW_TIP=$(gh api "repos/${GITHUB_REPOSITORY}/git/ref/heads/${BASE_REF}" --jq '"'"'.object.sha'"'"') || NOW_TIP=""' \
    'if ! [[ "$NOW_TIP" =~ ^[0-9a-f]{40,64}$ ]]; then' 'exit 1' 'fi' \
    "if [ \"\$NOW_TIP\" != \"\$$1\" ]; then" \
    'NOW_MB=$(gh api "repos/${GITHUB_REPOSITORY}/compare/${NOW_TIP}...${HEAD_SHA}" --jq '"'"'.merge_base_commit.sha // ""'"'"') || NOW_MB=""' \
    'if ! [[ "$NOW_MB" =~ ^[0-9a-f]{40,64}$ ]]; then' 'exit 1' 'fi' \
    'if [ "$NOW_MB" = "$HEAD_SHA" ]; then continue; fi' \
    "if [ \"\$NOW_MB\" != \"\$$2\" ]; then" 'exit 0' 'fi' 'fi'
}
if [ "$pre_put" != "$(before_call GATE_TIP GATE_MB; before_call TIP MB)" ]; then
  bad 7 "each merge loop must, before its merge call, read the pull request again (hand a merge this workflow's token made to the check, leave a hand merge alone, stop on a retarget), read the tip again and, when it moved, wait while the head is on the base branch already and stop if the merge base moved (promote-from-ci against GATE_TIP and GATE_MB, promote-docs against TIP and MB), fail on any failed read, with nothing else before the call"
fi
# After the last call, before calling the merge failed: the pull request read
# once more, a merge this workflow's token made handed to the check. From the
# loop's last wait to the step's end, nothing else runs.
after_loop=$(awk '/^            sleep "\$attempt"$/ { on = 1; print "@@" }
  on && /^          exit 1$/ { print "exit 1"; on = 0; next }
  on { line = $0; sub(/^ */, "", line); print line }' "$AM" \
  | grep -vE '^(#|$)' | grep -vE '^echo "([^"$`\\]|\$\{[A-Za-z_][A-Za-z0-9_]*(:[0-9]+:[0-9]+)?\})*"$' || true)
last_read=$(printf '%s\n' '@@' 'sleep "$attempt"' 'done' "$STATE_READ" 'if [ -z "$STATE" ]; then' 'exit 1' 'fi' "$STATE_SPLIT" \
  'if [ "$NOW_MERGED" = "true" ] && [ "$NOW_BY" = "github-actions[bot]" ]; then' \
  'echo "merged=true" >> "$GITHUB_OUTPUT"' 'echo "sha=${NOW_COMMIT}" >> "$GITHUB_OUTPUT"' 'exit 0' 'fi' 'exit 1')
if [ "$after_loop" != "$(printf '%s\n%s' "$last_read" "$last_read")" ]; then
  bad 7 "after the last merge call, each merge step must read the pull request once more, hand a merge this workflow's token made to the check, and otherwise fail — with nothing else between the loop and its end"
fi
reassigned=$(grep -cE '(^|[^A-Za-z0-9_])(ROWS|LISTED)\+?=' <<< "$jobs_code" || true)
if [ "$reassigned" != "$((2 * merging))" ]; then
  bad 7 "$reassigned assignment(s) of ROWS or LISTED in the jobs, $((2 * merging)) expected — the listing is counted on its pinned lines only"
fi
stale=$(grep -ciE 'base[._]sha|compare/\$\{?(BASE|DEFAULT)' <<< "$jobs_code" || true)
if [ "$stale" != "0" ]; then
  bad 7 "$stale line(s) name base.sha, base_sha or BASE_SHA, or compare from \${BASE…} or \${DEFAULT…} — GitHub does not move base.sha with the branch"
fi
# The compare lists 300 files at most, and the pull request's changed_files can
# come from another merge base than the tip's: equal counts do not prove a
# whole listing, so 300 files hold whatever the count. The branch holds: up to
# its `fi`, it only reports (a notice, merge=false) and leaves with `exit 0`.
cut=$(awk '/^          if \[ "\$LISTED" -ge 300 \] \|\| \[ "\$LISTED" != "\$CHANGED" \]; then$/ { armed = 1; regions++; next }
  armed && /^          fi$/ { armed = 0; next }
  armed && /^            exit 0$/ { exits++; next }
  armed && /^            echo "::notice::/ { next }
  armed && /^            echo "merge=false" >> "\$GITHUB_OUTPUT"$/ { next }
  armed { other++ }
  END { print regions + 0, exits + 0, other + 0 }' "$AM")
if [ "$cut" != "$merging $merging 0" ]; then
  bad 7 "the hold of a listing of 300 files, or of a gap with the pull request's count, must be in each of the $merging merging job(s) and only report and exit 0 (found: branches, exits, other lines = $cut)"
fi
# The branch name goes into the URL of that read: a name the API would read
# as another path (a `#`, a `?`, an encoded character) must hold, not resolve.
named=$(grep -cxF '          if ! [[ "$BASE_REF" =~ ^[A-Za-z0-9._/@+-]+$ && "$HEAD_SHA" =~ ^[0-9a-f]{40,64}$ ]]; then' "$AM" || true)
if [ "$named" != "$merging" ]; then
  bad 7 "$merging merging job(s) but $named check the base branch's name before reading its tip"
fi
tips=$(grep -cxF '          TIP=$(gh api "repos/${GITHUB_REPOSITORY}/git/ref/heads/${BASE_REF}" --jq '"'"'.object.sha'"'"') || TIP=""' "$AM" || true)
if [ "$tips" != "$merging" ]; then
  bad 7 "$merging merging job(s) but $tips read the base branch's tip by its full ref (git/ref/heads/\${BASE_REF})"
fi
tip_fails=$(awk '/^          if ! \[\[ "\$TIP" =~ \^\[0-9a-f\]\{40,64\}\$ \]\]; then$/ { armed = 1; next } armed && /^            exit 1$/ { n++ } /^          fi$/ { armed = 0 } END { print n + 0 }' "$AM")
if [ "$tip_fails" != "$merging" ]; then
  bad 7 "$merging merging job(s) but $tip_fails fail when the tip cannot be read — an unreadable tip must exit 1"
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
rechecked=$(grep -cxF '              if [ -z "$BASE_REF" ] || [ "$NOW_BASE" != "$BASE_REF" ]; then' "$AM" || true)
if [ "$rechecked" != "$merging" ]; then
  bad 7 "$merging merging job(s) but $rechecked re-read the base branch right before each merge call"
fi
foreign_base=$(grep -E '^ +(BASE_(SHA|REF)|TIP): ' "$AM" | grep -cvE '^ +BASE_REF: \$\{\{ (github\.event\.pull_request\.base\.ref|steps\.gate\.outputs\.base_ref) \}\}$' || true)
if [ "$foreign_base" != "0" ]; then
  bad 7 "BASE_REF must come from the triggering event or from the gate step's output, and no commit of the base may come from outside the job's own read of the tip"
fi
pass 7 "the gate reads one immutable range per job from the base branch's tip, holds a listing of 300 files, reads the pull request, the tip and the merge base again before each merge call, and fails on a failed read"

# ── AM-8 — tests that get weaker are held ───────────────────────────────────
# The CI that went green ran the tests as the pull request left them. What the
# gate can see without running anything is whether an EXISTING test lost
# something: the selection below is the workflow's own, run on the shapes of
# a compare listing.
TEST_RE=$(sed -n "s/^  TEST_HOLD_RE: '\(.*\)'$/\1/p" "$AM")
defined=$(grep -cE "^ *TEST_HOLD_RE:" "$AM" || true)
if [ -z "$TEST_RE" ] || [ "$defined" != "1" ]; then
  bad 8 "TEST_HOLD_RE must be defined exactly once (single-quoted, non-empty; '^\$' holds nothing) in the workflow-level env of $AM — found $defined"
else
  rc=0
  grep -qiE "$TEST_RE" <<< "x" 2> /dev/null || rc=$?
  [ "$rc" -le 1 ] || bad 8 "TEST_HOLD_RE is not a usable extended regular expression: $TEST_RE"
  if [ -f "$TABLE" ]; then
    while read -r want p rest; do
      case "$want" in test|not-test) ;; *) continue ;; esac
      [ -n "$p" ] && [ -z "$rest" ] || continue # malformed rows: reported by AM-1
      got=not-test
      if grep -qiE -e "$TEST_RE" <<< "$p" 2> /dev/null; then got=test; fi
      [ "$got" = "$want" ] || bad 8 "$TABLE says '$want $p' but TEST_HOLD_RE reads it as $got — fix the pattern or the row"
    done < "$TABLE"
  fi
fi
# Every merging job reads the same selection, applies the pattern to it and
# holds on any match — and both read the facts from the immutable range.
selections=$(sed -n "s/^ *SHRUNK=\$(jq -r '\(.*\)' <<< \"\$RANGE\")$/\1/p" "$AM")
n_sel=$(grep -c . <<< "$selections" || true)
n_distinct=$(sort -u <<< "$selections" | grep -c . || true)
applied=$(grep -cxF '          if [ -n "$SHRUNK" ]; then WEAKENED=$(grep -i -E -c -e "$TEST_HOLD_RE" <<< "$SHRUNK" || true); fi' "$AM" || true)
held=$(awk '/^          if \[ "\$WEAKENED" != "0" \]; then$/ { armed = 1; next } armed && /^            exit 0$/ { n++; armed = 0 } /^          fi$/ { armed = 0 } END { print n + 0 }' "$AM")
facts=$(grep -cF 'changes: [.files[]? | {filename, previous_filename, status, additions, deletions}]' "$AM" || true)
if [ "$n_sel" != "$merging" ] || [ "$n_distinct" != "1" ] || [ "$applied" != "$merging" ] || [ "$held" != "$merging" ] || [ "$facts" != "$((2 * merging))" ]; then
  bad 8 "$merging merging job(s), but $n_sel select the weakened files ($n_distinct distinct selection(s)), $applied apply TEST_HOLD_RE, $held hold on a match and $facts read the per-file facts (from the range, and from what the merge wrote: AM-10) — every merging job must do all four, with one selection"
fi
merged_after=$(awk '/^          if \[ "\$WEAKENED" != "0" \]; then$/ { f = 1; next } f && /^          fi$/ { f = 0 } f && /merge=true|pulls\/|gh pr ready/' "$AM" | grep -c . || true)
[ "$merged_after" = "0" ] || bad 8 "the branch that holds a pull request weakening tests must only report and exit"
if ! command -v jq > /dev/null 2>&1; then
  if [ -n "${CI:-}" ]; then bad 8 "jq is needed to run the selection of weakened files"; else note "AM-8: jq not found — the selection of weakened files was not run"; fi
elif [ "$n_distinct" = "1" ]; then
  filter=$(sort -u <<< "$selections")
  am8() { # am8 <expected: listed paths, space-separated, or -> <label> <one file object of a compare listing>
    local got
    got=$(jq -r "$filter" <<< "{\"changes\": [$3]}" 2> /dev/null | tr '\n' ' ' | sed 's/ $//')
    [ "${got:--}" = "$1" ] || bad 8 "weakened-files selection on '$2': listed '${got:--}', expected '$1'"
  }
  am8 -                  'a new test file'                 '{"filename":"tests/b.test.js","status":"added","additions":40,"deletions":0}'
  am8 -                  'lines added to an existing test' '{"filename":"tests/a.test.js","status":"modified","additions":12,"deletions":0}'
  am8 tests/a.test.js    'an assertion rewritten'          '{"filename":"tests/a.test.js","status":"modified","additions":1,"deletions":1}'
  am8 tests/a.test.js    'test lines removed'              '{"filename":"tests/a.test.js","status":"modified","additions":0,"deletions":9}'
  am8 tests/a.test.js    'a test file deleted'             '{"filename":"tests/a.test.js","status":"removed","additions":0,"deletions":30}'
  am8 'old/a.js tests/a.test.js' 'a test renamed away, unchanged' '{"filename":"old/a.js","previous_filename":"tests/a.test.js","status":"renamed","additions":0,"deletions":0}'
  am8 tests/a.snap       'a change with no line count (binary snapshot, mode)' '{"filename":"tests/a.snap","status":"modified","additions":0,"deletions":0}'
  am8 tests/a.test.js    'a status the gate does not know' '{"filename":"tests/a.test.js","status":"changed","additions":3,"deletions":0}'
  am8 tests/a.test.js    'no line counts at all'           '{"filename":"tests/a.test.js","status":"modified"}'
  am8 tests/c.test.js    'a copy'                          '{"filename":"tests/c.test.js","status":"copied","additions":0,"deletions":0}'
fi
pass 8 "a pull request that deletes, renames or rewrites lines of an existing file under TEST_HOLD_RE is held by the $merging merging job(s)"

# ── AM-10 — what the merge wrote is judged again ────────────────────────────
# The gate lists the changes since one merge base of the tip and the head; the
# merge writes what GitHub's merge engine computes. They agreed when this was
# tried live with two merge bases, but nothing documents it, and a branch
# landing between the last reads before the merge call and the call moves that
# merge base anyway. So right after each merge step, a step lists the commit
# the merge created against its first parent and runs the gate's rules on it.
# The merge is done: its job is to turn the run red, never to pass quietly.
# Nothing in the file may let a failing step pass, change the shell or the
# environment of a later step, or put an expression into a script: GitHub
# expands `${{ }}` inside a `run:` block before the shell reads it, comments
# included, so the text pinned below would not be what runs.
forbidden=$(grep -cE '^ *(continue-on-error|defaults|shell):|GITHUB_ENV|GITHUB_PATH' "$AM" || true)
if [ "$forbidden" != "0" ]; then
  bad 10 "$forbidden line(s) set continue-on-error, defaults or a shell, or write GITHUB_ENV or GITHUB_PATH — none belongs in this workflow"
fi
expressions=$(awk '/^ *run: [|>]/ { inrun = 1; key = index($0, "run:"); next }
  inrun && /^[[:space:]]*$/ { next }
  inrun { match($0, /^ */); if (RLENGTH < key) inrun = 0 }
  inrun && index($0, "${{") { n++ }
  /^ *(- )?run: [^|>]/ && index($0, "${{") { n++ }
  END { print n + 0 }' "$AM")
if [ "$expressions" != "0" ]; then
  bad 10 "$expressions line(s) of a run: script carry \${{ }}, comments included — pass values through env:"
fi
# Every line of the jobs, tagged with its job and its step (a step starts at any
# `- ` item of a job's steps, named or not).
steps_tsv=$(awk '/^jobs:$/ { on = 1; next }
  !on { next }
  /^  [A-Za-z0-9_-]+:$/ { job = $1; sub(/:$/, "", job); step = "-"; next }
  /^      - / { n++; step = n }
  { print job "\t" step "\t" $0 }' "$AM")
CHECK='Check what the merge wrote'
NAME="      - name: $CHECK"
checks=$(awk -F'\t' -v c="$NAME" '$3 == c' <<< "$steps_tsv" | grep -c . || true)
# The step right after the one whose id is `merge`, in each merging job: its
# first line is the check's name.
after_merge=$(awk -F'\t' -v c="$NAME" '$3 ~ /^      - / { if (want != "") { if ($1 == want && $3 == c) good++; else other++ } want = "" }
  $3 == "        id: merge" { want = $1 }
  END { print good + 0, other + 0 }' <<< "$steps_tsv")
if [ "$checks" != "$merging" ] || [ "$after_merge" != "$merging 0" ]; then
  bad 10 "$merging merging job(s) but $checks step(s) '$CHECK' (right after the merge step, named or not: found $after_merge) — each merging job judges what its merge wrote, in the step that follows it"
fi
step_of() { # the lines of the check step of job $1
  awk -F'\t' -v j="$1" -v c="$NAME" '$1 == j && $3 == c { s = $2 } $1 == j && s != "" && $2 == s { print $3 }' <<< "$steps_tsv"; }
# Up to its `run:`, each check step is exactly this: it runs whenever its merge
# happened, whatever failed before, and reads the commit its merge step wrote.
for job in promote-from-ci promote-docs; do
  case "$job" in
    promote-docs) pr_from='${{ github.event.pull_request.number }}'; docs="'true'" ;;
    *) pr_from='${{ steps.find-pr.outputs.pr }}'; docs="'false'" ;;
  esac
  header=$(sed '/^        run: |$/,$d' <<< "$(step_of "$job")" | grep -vE '^[[:space:]]*(#|$)' || true)
  expected_header=$(printf '%s\n' "$NAME" '        id: check' \
    "        if: \${{ !cancelled() && steps.merge.outputs.merged == 'true' }}" \
    '        env:' '          GH_TOKEN: ${{ github.token }}' "          PR: $pr_from" \
    '          MERGED: ${{ steps.merge.outputs.sha }}' "          DOCS_ONLY: $docs")
  if [ "$header" != "$expected_header" ]; then
    bad 10 "$job: the step '$CHECK' must run whenever its merge happened (if: \${{ !cancelled() && steps.merge.outputs.merged == 'true' }}), read the commit from MERGED: \${{ steps.merge.outputs.sha }}, set DOCS_ONLY: $docs, and nothing else before its run block"
  fi
done
# Its run block, in both jobs: comments, blank lines, indentation and plain
# messages aside (a message is one double-quoted string with nothing after it
# and no backslash, no `$(`, no backquote), exactly these lines. Every way out
# but the last line is `exit 1`; the weakened files are the gate's own
# selection (AM-8).
run_of() { sed -n '/^        run: |$/,$p' <<< "$1" | sed '1d; s/^ *//' | grep -vE '^(#|$)' \
  | grep -vE '^echo "([^"$`\\]|\$\{[A-Za-z_][A-Za-z0-9_]*(:[0-9]+:[0-9]+)?\})*"$' || true; }
gate_filter=$(sed -n "s/^ *SHRUNK=\$(jq -r '\(.*\)' <<< \"\$RANGE\")$/\1/p" "$AM" | sort -u)
IFS= read -r -d '' expected_run <<'RUN' || true
set -euo pipefail
if ! [[ "$MERGED" =~ ^[0-9a-f]{40,64}$ ]]; then
exit 1
fi
PARENT=""
for delay in 0 5 10; do
sleep "$delay"
PARENT=$(gh api "repos/${GITHUB_REPOSITORY}/git/commits/${MERGED}" --jq '.parents[0].sha // ""') || PARENT=""
if [[ "$PARENT" =~ ^[0-9a-f]{40,64}$ ]]; then break; fi
done
if ! [[ "$PARENT" =~ ^[0-9a-f]{40,64}$ ]]; then
exit 1
fi
WROTE=""
for delay in 0 5 10; do
sleep "$delay"
WROTE=$(gh api "repos/${GITHUB_REPOSITORY}/compare/${PARENT}...${MERGED}" \
--jq '{listed: (.files | type), files: [.files[]? | [.filename, (.previous_filename // "")]], changes: [.files[]? | {filename, previous_filename, status, additions, deletions}]}') || WROTE=""
if [ -n "$WROTE" ] && [ "$(jq -r '.listed' <<< "$WROTE")" = "array" ]; then break; fi
done
if [ -z "$WROTE" ] || [ "$(jq -r '.listed' <<< "$WROTE")" != "array" ]; then
exit 1
fi
WROTE_ROWS=$(jq -r '.files[] | @tsv' <<< "$WROTE")
WROTE_COUNT=$(grep -c . <<< "$WROTE_ROWS" || true)
WROTE_PATHS=$(tr '\t' '\n' <<< "$WROTE_ROWS" | grep . || true)
HELD=0
NON_DOCS=0
if [ -n "$WROTE_PATHS" ]; then
HELD=$(grep -i -E -c -e "$CLAUDE_GATE_RE" -e "$PROJECT_GATE_RE" <<< "$WROTE_PATHS" || true)
if [ "$DOCS_ONLY" = "true" ]; then NON_DOCS=$(grep -E -v -c '(\.md$|^docs/|^LICENSE$|^\.gitignore$)' <<< "$WROTE_PATHS" || true); fi
fi
WROTE_SHRUNK=@@
WEAKENED=0
if [ -n "$WROTE_SHRUNK" ]; then WEAKENED=$(grep -i -E -c -e "$TEST_HOLD_RE" <<< "$WROTE_SHRUNK" || true); fi
if [ "$WROTE_COUNT" -ge 300 ] || [ "$HELD" != "0" ] || [ "$WEAKENED" != "0" ] || [ "$NON_DOCS" != "0" ]; then
exit 1
fi
RUN
expected_run=${expected_run%$'\n'}
# The selection line is compared as a string, apart: it must be the gate's.
shrunk_line="WROTE_SHRUNK=\$(jq -r '$gate_filter' <<< \"\$WROTE\")"
for job in promote-from-ci promote-docs; do
  run=$(run_of "$(step_of "$job")")
  if [ -z "$gate_filter" ] || [ "$(grep -c . <<< "$gate_filter")" != "1" ] \
     || [ "$(grep -c '^WROTE_SHRUNK=' <<< "$run")" != "1" ] \
     || [ "$(grep '^WROTE_SHRUNK=' <<< "$run")" != "$shrunk_line" ] \
     || [ "$(sed 's/^WROTE_SHRUNK=.*/WROTE_SHRUNK=@@/' <<< "$run")" != "$expected_run" ]; then
    bad 10 "$job: the run block of '$CHECK' changed — comments and messages aside, it must read the merge commit's first parent, list compare/\${PARENT}...\${MERGED} whole, run the gate's patterns, its selection of weakened files and (docs job) the docs rule on it, and exit 1 on anything found or unreadable"
  fi
done
# The merge steps hand it the commit GitHub created, or the one a merge already
# made carries: right after each line that says a merge happened, and on no
# other line that writes `sha=`.
handover=$(awk '$0 ~ /^ +echo "merged=true" >> "\$GITHUB_OUTPUT"$/ { armed = 1; merged++; next }
  armed && $0 ~ /^ +echo "sha=\$\(jq -r '"'"'\.sha \/\/ empty'"'"' <<< "\$OUT"\)" >> "\$GITHUB_OUTPUT"$/ { made++ }
  armed && $0 ~ /^ +echo "sha=\$\{NOW_COMMIT\}" >> "\$GITHUB_OUTPUT"$/ { found++ }
  { armed = 0 }
  END { print merged + 0, made + 0, found + 0 }' "$AM")
shas=$(grep -E '(^|[^A-Za-z0-9_])sha=' <<< "$jobs_code" | grep -c 'GITHUB_OUTPUT' || true)
if [ "$handover" != "$((3 * merging)) $merging $((2 * merging))" ] || [ "$shas" != "$((3 * merging))" ]; then
  bad 10 "each merge step must write sha=<the merge commit> right after each merged=true, on the two pinned lines, and nowhere else (found: merged=true lines, made, found = $handover; lines writing sha= = $shas)"
fi
pass 10 "what each merge wrote is listed and judged again by the gate's rules, right after the merge, and turns the run red"

# Advisory: nothing merges code until the workflow waited for exists.
ci_name=$(sed -n 's/^    workflows: \["\([^"]*\)", "Claude review"]$/\1/p' "$AM")
if [ -n "$ci_name" ]; then
  found=0
  for wf in .github/workflows/*.yml .github/workflows/*.yaml; do
    [ -f "$wf" ] || continue
    name=$(sed -n 's/^name:[[:space:]]*//p' "$wf" | head -n 1 | sed -e 's/[[:space:]]*#.*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/")
    if [ "$name" = "$ci_name" ]; then
      found=1
      # AM-9: a pull request retargeted to the default branch starts no run
      # unless `edited` is among the pull_request types; the commit's only CI
      # run could then be a copy that a pull request into another branch ran.
      if ! grep -qE '^ +types: \[(.*[, ])?edited *(,.*)?\]' "$wf"; then
        fail "AM-9: $wf (\"$ci_name\") must list 'edited' in its pull_request types — a pull request retargeted to the default branch would otherwise be merged on a CI run of another branch's copy (auto-merge-policy.md § The gate judges what is merged)"
        am9=1
      fi
    fi
  done
  if [ "$found" = 0 ]; then
    note "no workflow named \"$ci_name\" under .github/workflows/ — until one exists, only docs-only pull requests are merged"
  elif [ "${am9:-0}" = 0 ]; then
    ok "AM-9: the CI workflow runs again when a pull request is retargeted"
  fi
fi

finish
