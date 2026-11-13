#!/usr/bin/env bash
# ED-1..3 — the eco-design audit in CI (docs/conventions/eco-design.md).
#   ED-1  scripts/eco-design.config.json names the repository to fetch
#         (owner/name), a full 40-character commit and a fail_on among none,
#         low, medium and high. The workflow runs what it names on every pull
#         request: a branch or a short commit would let it change unread.
#   ED-2  node --test scripts/eco-design-audit.test.mjs — which files are
#         audited, what a change is charged with, the detectors left out, the
#         report, and a run that fails rather than reads as clean.
#   ED-3  .github/workflows/eco-design.yml runs third-party code on files a
#         pull request writes. Its triggers stay pull_request and
#         workflow_dispatch, its one permission contents: read under
#         `permissions: {}`; it reads no secret and its checkout keeps no
#         credential.
. "$(dirname "$0")/_lib.sh"

C=scripts/eco-design.config.json
W=.github/workflows/eco-design.yml

# ─── ED-3 ───────────────────────────────────────────────────────────────
if [ ! -f "$W" ]; then
  fail "ED-3: $W is missing"
else
  bad=""
  triggers=$(awk '/^on:/{f=1;next} f&&/^[^ #]/{f=0} f&&/^  [a-z_]+:/{sub(/:.*/,"");gsub(/ /,"");print}' "$W" | sort | tr '\n' ' ')
  [ "$triggers" = "pull_request workflow_dispatch " ] || bad="$bad triggers other than pull_request and workflow_dispatch (${triggers:-none});"
  grep -qxF 'permissions: {}' "$W" || bad="$bad no \`permissions: {}\` at workflow level;"
  perms=$(grep -E '^\s+(actions|attestations|checks|contents|deployments|discussions|id-token|issues|models|packages|pages|pull-requests|repository-projects|security-events|statuses): ' "$W" | sed -E 's/ *#.*//; s/^ +//' | sort | tr '\n' ' ')
  [ "$perms" = "contents: read " ] || bad="$bad permissions other than contents: read (${perms:-none});"
  grep -nE 'secrets\.|read-all|write-all' "$W" | grep -vE '^[0-9]+:\s*#' >/dev/null && bad="$bad a secret or a blanket permission;"
  checkouts=$(grep -cE 'uses: actions/checkout@' "$W" || true)
  kept=$(grep -cE '^\s+persist-credentials: false' "$W" || true)
  [ "$checkouts" = "$kept" ] || bad="$bad a checkout that keeps its credential;"
  if [ -z "$bad" ]; then
    ok "ED-3: pull_request and workflow_dispatch only, contents: read, no secret, no credential kept"
  else
    fail "ED-3: $W holds$bad"
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  if [ -n "${CI:-}" ]; then
    fail "ED-1: node is not available, the configuration and the audit script cannot be checked"
  else
    note "ED-1, ED-2: node not found — the configuration and the audit script are not checked"
  fi
  finish
fi

# ─── ED-1 ───────────────────────────────────────────────────────────────
if [ ! -f "$C" ]; then
  fail "ED-1: $C is missing — the workflow has nothing to fetch"
elif msg=$(node -e '
  let c;
  try { c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); }
  catch (e) { console.log(`not valid JSON (${e.message})`); process.exit(1); }
  const failOn = String(c.fail_on ?? "none").toLowerCase();
  const bad = [];
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(c.repository ?? ""))) bad.push("repository is not owner/name");
  if (!/^[0-9a-f]{40}$/.test(String(c.commit ?? ""))) bad.push("commit is not a full 40-character commit");
  if (!["none", "low", "medium", "high"].includes(failOn)) bad.push("fail_on is not none, low, medium or high");
  if (bad.length) { console.log(bad.join("; ")); process.exit(1); }
  console.log(`${c.repository} at ${c.commit.slice(0, 7)}, fail_on ${failOn}`);
' "$C" 2>&1); then
  ok "ED-1: $C pins $msg"
else
  fail "ED-1: $C — $msg"
fi

# ─── ED-2 ───────────────────────────────────────────────────────────────
if out=$(node --test scripts/eco-design-audit.test.mjs 2>&1); then
  ok "ED-2: the audit script passes its tests"
else
  printf '%s\n' "$out" | grep -E '^(✖|not ok)|AssertionError|Error:' | head -n 20 >&2
  fail "ED-2: node --test scripts/eco-design-audit.test.mjs fails (see above)"
fi

finish
