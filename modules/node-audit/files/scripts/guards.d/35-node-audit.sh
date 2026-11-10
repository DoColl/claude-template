#!/usr/bin/env bash
# NA-1..2 — npm audit gate (docs/conventions/node-audit.md).
#   NA-1  no advisory at high or above in the lockfile of each workspace below,
#         dev dependencies included, unless scripts/audit-allowlist.json
#         accepts that one advisory for that one package, with a reason and a
#         review date that has not passed (scripts/audit-gate.mjs). The audit
#         resolves the advisory graph from package-lock.json through the
#         registry: no node_modules needed, but it needs the network, so it is
#         skipped with --offline and CI is where it gates.
#   NA-2  the gate's own self-test (scripts/audit-gate.test.mjs): it fails
#         closed when npm fails or its report changes shape, and a derogation
#         stays as narrow as written. Offline and fast, so it runs every time.
. "$(dirname "$0")/_lib.sh"

workspaces="__HARNESS_NODE_WORKSPACES__"

# Leaves the guard without auditing, never hiding an earlier failure behind
# the "skipped" exit code.
leave() {
  if [ "$failures" -gt 0 ]; then
    note "NA-1: skipped — $1"
    finish
  fi
  skip "NA-1: $1"
}

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  if [ -n "${CI:-}" ]; then
    fail "NA-1: node and npm are mandatory on a CI runner"
    finish
  fi
  skip "NA-1: node or npm not found"
fi

if selftest=$(node --test scripts/audit-gate.test.mjs 2>&1); then
  ok "NA-2: the audit gate fails closed and keeps derogations narrow (self-test)"
else
  fail "NA-2: scripts/audit-gate.test.mjs fails — run: node --test scripts/audit-gate.test.mjs"
  printf '%s\n' "$selftest" | grep -E '^(not ok|✖)|AssertionError|Error:' | head -20 | sed 's/^/          /' >&2
fi

audited=""
for dir in $workspaces; do
  if [ ! -d "$dir" ]; then
    fail "NA-1: workspace '$dir' does not exist — fix the workspaces= line of this guard"
  elif [ -f "$dir/package-lock.json" ]; then
    audited="$audited $dir"
  else
    note "NA-1: $dir has no package-lock.json — nothing to audit there"
  fi
done

[ -n "$audited" ] || leave "no package-lock.json in: $workspaces"
offline && leave "npm audit needs the registry — not run offline"

known=$(printf '%s' "$workspaces" | tr ' ' ',')
for dir in $audited; do
  if node scripts/audit-gate.mjs --workspaces="$known" "$dir"; then
    ok "NA-1: $dir — no unlisted high+ advisory"
  else
    fail "NA-1: $dir — unlisted high+ advisories, or the audit could not be trusted (above)"
  fi
done

finish
