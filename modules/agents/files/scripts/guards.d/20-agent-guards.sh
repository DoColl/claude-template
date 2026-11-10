#!/usr/bin/env bash
# AG-1..2 — the sub-agent Bash allowlist (docs/conventions/agent-bash-guard.md).
#   AG-1  node --test .claude/hooks/agent-bash-guard.test.mjs — the allow/block
#         table per profile, the CLI exit codes, the project's verification
#         config, and the real frontmatter hook line of every read-only agent
#         (blocks a write, allows a read, blocks when the guard is missing).
#   AG-2  every file under .claude/hooks/ is tracked by git and matches no
#         .gitignore rule. On a clone, a missing guard blocks every command of
#         the guarded agents through `|| exit 2`: fail closed, but useless.
. "$(dirname "$0")/_lib.sh"

if ! command -v node >/dev/null 2>&1; then
  fail "AG-1: node is not installed — the hook needs it, and without it blocks every Bash command of the guarded agents"
  finish
fi

if out=$(node --test .claude/hooks/agent-bash-guard.test.mjs 2>&1); then
  ok "AG-1: the allowlist specification passes"
else
  printf '%s\n' "$out" | grep -E '^(✖|not ok)|should (allow|block|reject)|must |AssertionError|Error:' | head -40 >&2
  fail "AG-1: node --test .claude/hooks/agent-bash-guard.test.mjs fails (see above)"
fi

if in_git; then
  bad=0
  for f in .claude/hooks/*; do
    [ -f "$f" ] || continue
    if ! git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
      fail "AG-2: $f is not tracked by git"
      bad=1
    fi
    # --no-index: without it a tracked file is never reported as ignored, and the rule would go untested.
    if git check-ignore -q --no-index "$f"; then
      fail "AG-2: $f matches a .gitignore rule (is the !.claude/hooks/ negation gone?)"
      bad=1
    fi
  done
  [ "$bad" -eq 1 ] || ok "AG-2: every hook file is tracked and not ignored"
else
  note "AG-2: not a git work tree — tracking of .claude/hooks/ not checked"
fi

finish
