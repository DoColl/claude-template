#!/usr/bin/env bash
# OS-1 — the OpenSpec artefacts are valid (docs/conventions/openspec-workflow.md).
#   OS-1  `openspec validate --all --strict --no-interactive` passes: every spec
#         and every change in flight has the shape the workflow relies on.
# Skipped without the CLI (it is a developer tool; pin it and install it in CI
# if you want this enforced there) and when there is nothing to validate yet.
. "$(dirname "$0")/_lib.sh"

if [ ! -d openspec ]; then
  skip "OS-1: no openspec/ directory yet — run \`openspec init\`"
fi

specs=$(find openspec/specs -name spec.md 2>/dev/null | head -n 1)
changes=$(find openspec/changes -mindepth 1 -maxdepth 1 -type d ! -name archive 2>/dev/null | head -n 1)
if [ -z "$specs" ] && [ -z "$changes" ]; then
  skip "OS-1: no spec and no change in flight yet"
fi

if ! command -v openspec >/dev/null 2>&1; then
  skip "OS-1: the openspec CLI is not installed"
fi

if out=$(OPENSPEC_TELEMETRY=0 openspec validate --all --strict --no-interactive 2>&1); then
  ok "OS-1: openspec validate passes"
else
  printf '%s\n' "$out" | tail -n 30 >&2
  fail "OS-1: openspec validate --all --strict fails (see above)"
fi

finish
