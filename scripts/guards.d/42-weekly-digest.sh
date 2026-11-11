#!/usr/bin/env bash
# WD-1 — weekly digest self-test (docs/conventions/weekly-digest.md).
#   WD-1  node --test scripts/weekly-digest.test.mjs — the digest's pure logic
#         (what is listed and why, deadlines, mention-proof titles), the
#         discovery of every workflow with a `schedule:`, the project settings,
#         the two declarations the digest reads from auto-merge.yml when
#         that workflow is installed, and the paths the CI workflow takes back
#         after skipping documentation (its `pull_request` trigger, unless
#         `ciAlsoRunsOn` is set). A renamed variable there, or a typo in
#         scripts/weekly-digest.config.mjs, would otherwise only show as a
#         failed run on the digest's scheduled day — a week later; a CI
#         trigger the digest cannot read, as a mere warning in that run.
# The digest workflow itself does not run this test: a red WD-1 must never
# silence a digest.
. "$(dirname "$0")/_lib.sh"

if ! command -v node >/dev/null 2>&1; then
  if [ -n "${CI:-}" ]; then
    fail "WD-1: node is not available, the weekly digest self-test cannot run"
    finish
  fi
  skip "WD-1: node not found"
fi

if out=$(node --test scripts/weekly-digest.test.mjs 2>&1); then
  ok "WD-1: digest logic, scheduled-workflow discovery, settings, auto-merge.yml and CI trigger readers"
else
  printf '%s\n' "$out" | grep -E '^(✖|not ok)|AssertionError|Error:' | head -n 20 >&2
  fail "WD-1: weekly digest self-test failed — run: node --test scripts/weekly-digest.test.mjs"
fi

finish
