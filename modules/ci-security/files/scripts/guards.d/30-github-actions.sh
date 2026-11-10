#!/usr/bin/env bash
# GA-1..2 — GitHub Actions workflows (docs/conventions/github-actions-rules.md).
#   GA-1  every non-local `uses:` under .github/ names a 40-char commit SHA, or
#         a sha256 digest for `docker://` refs. A tag or a branch moves with
#         whoever controls the action's repository; a commit does not. Local =
#         `./` or `$/`, i.e. this repository at the caller's commit.
#   GA-2  zizmor (static analysis of workflows: unpinned actions, template
#         injection, dangerous triggers, token over-permission) reports
#         nothing on .github/workflows/, at any severity, at the version
#         pinned below. Triage decisions live in .github/zizmor.yml, each
#         with its justification.
#
# zizmor is fetched from PyPI at an exact version (uvx, else pipx): each
# release adds audits, so a floating install would turn the gate red with no
# change in the repository. With `--offline` the gate stays off the network:
# only a copy already in uv's cache is used (`uvx --offline`); pipx has no such
# mode, so with pipx alone GA-2 is skipped offline. No tool, or nothing cached:
# skipped on a contributor's machine, failed when $CI is set — a runner
# without the tool must not turn the gate green. zizmor's own `--offline`
# means "no GitHub API": the audits that need a token (impostor commits,
# known-vulnerable actions) do not run.
. "$(dirname "$0")/_lib.sh"

ZIZMOR_VERSION=1.31.1

# ─── GA-1 ───────────────────────────────────────────────────────────────
if [ -d .github ]; then
  q="[\"']?" # optional YAML quote around the value
  unpinned=$(grep -rnE --include='*.yml' --include='*.yaml' '(^[[:space:]]*(-[[:space:]]+)?|[{,][[:space:]]*)uses:' .github/ \
    | grep -vE "uses:[[:space:]]*${q}(\./|[\$]/)" \
    | grep -vE "uses:[[:space:]]*${q}[^[:space:]\"'#@]+@([0-9a-f]{40}|sha256:[0-9a-f]{64})${q}([[:space:]#,}]|\$)" \
    || true)
  if [ -n "$unpinned" ]; then
    fail "GA-1: every non-local uses: must be pinned to a 40-char commit SHA (docker:// refs: an @sha256 digest):"
    printf '%s\n' "$unpinned" | sed 's/^/          /' >&2
  else
    ok "GA-1: every non-local uses: is pinned to a full SHA or digest"
  fi
else
  ok "GA-1: no .github/ directory, nothing to pin"
fi

# Advisory: security.yml gates pull requests only once a CI workflow calls it.
if [ -f .github/workflows/security.yml ]; then
  if ! grep -lE "uses:[[:space:]]*[\"']?(\./|[\$]/)\.github/workflows/security\.yml" .github/workflows/*.yml .github/workflows/*.yaml 2>/dev/null | grep -q .; then
    note "security.yml is not called by any workflow yet: its enforcing job does not run on pull requests (docs/conventions/security-workflow.md § Wiring)"
  fi
fi

# ─── GA-2 ───────────────────────────────────────────────────────────────
# Leaves the guard without running zizmor: failed on a runner, never hiding a
# GA-1 failure behind the "skipped" exit code.
ga2_skip() {
  if [ -n "${CI:-}" ]; then
    fail "GA-2: $1 — zizmor is mandatory on a CI runner"
    finish
  fi
  if [ "$failures" -gt 0 ]; then
    note "GA-2: skipped — $1"
    finish
  fi
  skip "GA-2: $1"
}

has_workflow=false
for f in .github/workflows/*.yml .github/workflows/*.yaml; do
  [ -f "$f" ] && has_workflow=true
done
if [ "$has_workflow" = false ]; then
  ok "GA-2: no workflow to audit"
  finish
fi

if command -v uvx >/dev/null 2>&1; then
  if offline; then
    set -- uvx --offline --from "zizmor==$ZIZMOR_VERSION" zizmor
  else
    set -- uvx --from "zizmor==$ZIZMOR_VERSION" zizmor
  fi
elif command -v pipx >/dev/null 2>&1; then
  if offline; then
    ga2_skip "pipx cannot be kept off the network (install uv, or run the gate without --offline)"
  fi
  set -- pipx run --spec "zizmor==$ZIZMOR_VERSION" zizmor
else
  ga2_skip "neither uvx nor pipx found, zizmor $ZIZMOR_VERSION cannot run"
fi

if ! "$@" --version >/dev/null 2>&1; then
  if offline; then
    ga2_skip "zizmor $ZIZMOR_VERSION is not in the local cache (run the gate once without --offline)"
  else
    ga2_skip "zizmor $ZIZMOR_VERSION could not be fetched from PyPI"
  fi
fi

rc=0
"$@" --offline .github/workflows/ || rc=$?
case "$rc" in
  0) ok "GA-2: zizmor $ZIZMOR_VERSION reports nothing" ;;
  10|11|12|13|14) fail "GA-2: zizmor $ZIZMOR_VERSION reports findings (above) — fix them, or record the triage in .github/zizmor.yml with its justification" ;;
  *) fail "GA-2: zizmor $ZIZMOR_VERSION itself failed (exit $rc, see above)" ;;
esac

finish
