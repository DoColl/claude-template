#!/usr/bin/env bash
# CM-1..2 — CLAUDE.md stays a budgeted index (docs/conventions/claude-md.md).
#   CM-1  CLAUDE.md declares its byte budget on a `harness:budget <bytes>` line
#         and is not larger than it. The file is loaded into every session and
#         most sub-agents: without a check, it only grows.
#   CM-2  every docs/….md path CLAUDE.md names exists — a rule whose detail
#         file is gone points nowhere.
. "$(dirname "$0")/_lib.sh"

f=CLAUDE.md
if [ ! -f "$f" ]; then
  fail "CM-1: $f is missing"
  finish
fi

budget=$(sed -n 's/.*harness:budget \([0-9][0-9]*\).*/\1/p' "$f" | head -n 1)
size=$(wc -c < "$f" | tr -d ' ')
if [ -z "$budget" ]; then
  fail "CM-1: $f has no 'harness:budget <bytes>' line"
elif [ "$size" -gt "$budget" ]; then
  fail "CM-1: $f is $size bytes, over its budget of $budget — move detail to docs/conventions/ (or raise the budget on purpose, in a reviewed change)"
else
  ok "CM-1: $f is $size bytes (budget $budget)"
fi

missing=0
for p in $(grep -oE 'docs/[A-Za-z0-9_./-]+\.md' "$f" | sort -u); do
  if [ ! -f "$p" ]; then
    fail "CM-2: $f points to $p, which does not exist"
    missing=$((missing + 1))
  fi
done
[ "$missing" -gt 0 ] || ok "CM-2: every docs/ path named in $f exists"

finish
