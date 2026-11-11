#!/usr/bin/env bash
# The local gate. Runs every guard in scripts/guards.d/ (NN-name.sh, in
# order). A CI workflow is meant to run this same script, so that a green gate
# here is a green gate there; until one does, this run is the only one
# (docs/conventions/local-gate.md).
#
#   ./scripts/security-checks.sh            everything
#   ./scripts/security-checks.sh --offline  skip what needs the network
#
# A guard is a bash script that exits 0 (pass), 77 (skipped: tool missing or
# offline) or anything else (fail). Project regression checks go in
# scripts/guards.d/50-project.sh; a new family of checks is a new NN-name.sh.
set -uo pipefail
cd "$(dirname "$0")/.."

offline=false
for arg in "$@"; do
  case "$arg" in
    --offline) offline=true ;;
    *) echo "usage: $0 [--offline]" >&2; exit 2 ;;
  esac
done
export HARNESS_OFFLINE="$offline"

passed=0
failed=""
skipped=""
ran=0
for guard in scripts/guards.d/[0-9][0-9]-*.sh; do
  [ -f "$guard" ] || continue
  ran=$((ran + 1))
  name=$(basename "$guard" .sh)
  printf '\n== %s ==\n' "$name"
  bash "$guard"
  case $? in
    0) passed=$((passed + 1)) ;;
    77) skipped="$skipped $name" ;;
    *) failed="$failed $name" ;;
  esac
done

if [ "$ran" -eq 0 ]; then
  echo "no guard found in scripts/guards.d/ — the gate checked nothing" >&2
  exit 1
fi

printf '\n%d guard(s): %d passed' "$ran" "$passed"
[ -z "$skipped" ] || printf ', skipped:%s' "$skipped"
if [ -n "$failed" ]; then
  printf '\nFAILED:%s\n' "$failed" >&2
  exit 1
fi
printf '\n'
