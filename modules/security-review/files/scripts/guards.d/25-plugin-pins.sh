#!/usr/bin/env bash
# PL-1 — Claude Code plugins stay at the commit that was reviewed
# (docs/conventions/security-review.md § Plugins).
#   PL-1  scripts/plugin-pins.mjs: every plugin recorded as "retained" in
#         scripts/reviewed-plugins.json is installed at the recorded commit, and
#         no "rejected" plugin is installed. Its self-test runs first.
# The comparison is local: a CI runner has no plugins, the script skips there.
. "$(dirname "$0")/_lib.sh"

if ! command -v node >/dev/null 2>&1; then
  fail "PL-1: node is not installed"
  finish
fi

if out=$(node --test scripts/plugin-pins.test.mjs 2>&1); then
  ok "PL-1: the comparison script passes its self-test"
else
  printf '%s\n' "$out" | grep -E '^(✖|not ok)|AssertionError|Error:' | head -20 >&2
  fail "PL-1: node --test scripts/plugin-pins.test.mjs fails (see above)"
fi

if out=$(node scripts/plugin-pins.mjs 2>&1); then
  printf '%s\n' "$out"
else
  printf '%s\n' "$out" >&2
  fail "PL-1: a plugin is not at its reviewed commit, or a rejected one is installed (see above)"
fi

finish
