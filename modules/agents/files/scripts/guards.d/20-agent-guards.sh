#!/usr/bin/env bash
# AG-1..2 — the sub-agent Bash allowlist (docs/conventions/agent-bash-guard.md).
#   AG-1  node --test .claude/hooks/agent-bash-guard.test.mjs — the allow/block
#         table per profile, the CLI exit codes, the project's verification
#         config, and the real frontmatter hook line of every read-only agent
#         (blocks a write, allows a read, blocks when the guard is missing);
#         then agent-bash-guard.mutants.test.mjs — the specification run on
#         broken copies of the lib, each caught by the row it names.
#   AG-2  every file under .claude/hooks/ is tracked by git and matches no
#         .gitignore rule. On a clone, a missing guard blocks every command of
#         the guarded agents through `|| exit 2`: fail closed, but useless.
#         One state is a note instead of a failure: right after an
#         installation, before its first `git add`, nothing of the harness is
#         tracked yet — .claude/harness.json is not either. Once that manifest
#         is tracked, or on a CI runner, an untracked hook file fails.
. "$(dirname "$0")/_lib.sh"

if ! command -v node >/dev/null 2>&1; then
  fail "AG-1: node is not installed — the hook needs it, and without it blocks every Bash command of the guarded agents"
  finish
fi

if out=$(node --test .claude/hooks/agent-bash-guard.test.mjs .claude/hooks/agent-bash-guard.mutants.test.mjs 2>&1); then
  ok "AG-1: the allowlist specification passes, and fails on every mutant of the lib"
else
  printf '%s\n' "$out" | grep -E '^(✖|not ok)|should (allow|block|reject)|must |AssertionError|Error:' | head -40 >&2
  fail "AG-1: node --test .claude/hooks/agent-bash-guard.test.mjs .claude/hooks/agent-bash-guard.mutants.test.mjs fails (see above)"
fi

if in_git; then
  # The installer's manifest stands for "the harness is in git": tracked with
  # the hooks left out is the regression AG-2 exists for; neither tracked is a
  # fresh installation that has not been staged yet.
  staged=true
  if [ -z "${CI:-}" ] && ! git ls-files --error-unmatch .claude/harness.json >/dev/null 2>&1; then
    staged=false
  fi
  bad=0
  pending=0
  for f in .claude/hooks/*; do
    [ -f "$f" ] || continue
    if ! git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
      if [ "$staged" = true ]; then
        fail "AG-2: $f is not tracked by git"
        bad=1
      else
        pending=$((pending + 1))
      fi
    fi
    # --no-index: without it a tracked file is never reported as ignored, and the rule would go untested.
    if git check-ignore -q --no-index "$f"; then
      fail "AG-2: $f matches a .gitignore rule (is the !.claude/hooks/ negation gone?)"
      bad=1
    fi
  done
  if [ "$bad" -eq 1 ]; then
    :
  elif [ "$pending" -gt 0 ]; then
    note "AG-2: $pending hook file(s) not in git yet, like the rest of the installation (.claude/harness.json is not tracked either) — run 'git add -A' before the first commit; from then on an untracked hook file fails this check"
  else
    ok "AG-2: every hook file is tracked and not ignored"
  fi
else
  note "AG-2: not a git work tree — tracking of .claude/hooks/ not checked"
fi

finish
