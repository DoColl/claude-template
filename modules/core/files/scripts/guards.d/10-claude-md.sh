#!/usr/bin/env bash
# CM-1..2 — CLAUDE.md stays a budgeted index (docs/conventions/claude-md.md).
#   CM-1  CLAUDE.md declares its byte budget on a `harness:budget <bytes>` line
#         and what a session loads at launch is not larger than it: the file
#         without its block-level HTML comments (Claude Code strips them before
#         injection), plus every `.claude/rules/**.md` that has no `paths:`
#         frontmatter (loaded at launch, like CLAUDE.md). The file is loaded
#         into every session and most sub-agents: without a check, it only
#         grows — and an unscoped rule file would be the way around the check.
#   CM-2  every docs/….md path CLAUDE.md names exists — a rule whose detail
#         file is gone points nowhere.
. "$(dirname "$0")/_lib.sh"

f=CLAUDE.md
if [ ! -f "$f" ]; then
  fail "CM-1: $f is missing"
  finish
fi

# Bytes of the block-level HTML comments, counted narrowly: a comment that
# opens at column 0, outside a fenced code block, and whose closing `-->` ends
# its line. Anything else (indented, inline, followed by text, never closed)
# stays in the count.
hidden_bytes() {
  LC_ALL=C awk '
    function fence_char(l) { sub(/^ ? ? ?/, "", l); return substr(l, 1, 3) == "```" ? "`" : substr(l, 1, 3) == "~~~" ? "~" : "" }
    {
      len = length($0) + 1
      if (c) {
        i = index($0, "-->")
        if (!i) { pending += len; next }
        if (substr($0, i + 3) ~ /^[ \t]*$/) hidden += pending + len
        c = 0; pending = 0; next
      }
      f = fence_char($0)
      if (fence != "") { if (f == fence) fence = ""; next }
      if (f != "") { fence = f; next }
      if (substr($0, 1, 4) == "<!--") {
        i = index($0, "-->")
        if (!i) { c = 1; pending = len; next }
        if (substr($0, i + 3) ~ /^[ \t]*$/) hidden += len
      }
    }
    END { print hidden + 0 }' "$1"
}

# A rule file is path-scoped when its frontmatter has a `paths:` key. Without
# one it is loaded at launch, so it counts.
unscoped_rules_bytes() {
  total=0
  [ -d .claude/rules ] || { echo 0; return; }
  for r in $(find .claude/rules -name '*.md' -type f | LC_ALL=C sort); do
    if ! LC_ALL=C awk 'NR == 1 { if ($0 != "---") exit 1; next } $0 == "---" { exit 1 } /^paths:/ { found = 1; exit 0 } END { if (!found) exit 1 }' "$r"; then
      total=$((total + $(wc -c < "$r" | tr -d ' ')))
    fi
  done
  echo "$total"
}

budget=$(sed -n 's/.*harness:budget \([0-9][0-9]*\).*/\1/p' "$f" | head -n 1)
raw=$(wc -c < "$f" | tr -d ' ')
hidden=$(hidden_bytes "$f")
rules=$(unscoped_rules_bytes)
size=$((raw - hidden + rules))
detail="$raw on disk, $hidden in block comments, $rules in unscoped .claude/rules"
if [ -z "$budget" ]; then
  fail "CM-1: $f has no 'harness:budget <bytes>' line"
elif [ "$size" -gt "$budget" ]; then
  fail "CM-1: $f loads $size bytes into a session ($detail), over its budget of $budget — move detail to docs/conventions/, scope a rule to its files in .claude/rules/ (or raise the budget on purpose, in a reviewed change)"
else
  ok "CM-1: $f loads $size bytes into a session ($detail; budget $budget)"
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
