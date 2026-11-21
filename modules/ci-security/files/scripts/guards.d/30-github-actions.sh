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
# zizmor is the release archive of the pinned version for this platform,
# checked against the sha256 recorded below before anything is unpacked
# (scripts/fetch-pinned-release.sh): this binary decides what merges, here
# and in CI. A pinned version because each release adds audits, and a
# floating install would turn the gate red with no change in the repository.
# The archive is kept in ${XDG_CACHE_HOME:-~/.cache}/harness/zizmor/<version>/
# and checked again on every run. With `--offline` the gate stays off the
# network and uses that cache only. A hash that does not match fails, always.
# A platform with no pin, a download that fails, or nothing cached offline:
# skipped on a contributor's machine, failed when $CI is set — a runner
# without the tool must not turn the gate green. zizmor's own `--offline`
# means "no GitHub API": the audits that need a token (impostor commits,
# known-vulnerable actions) do not run.
. "$(dirname "$0")/_lib.sh"

# Bump: docs/conventions/security-workflow.md § Pinned scanners. Each sha256
# is the archive's, read in the release's build provenance attestation
# (`gh attestation verify --repo zizmorcore/zizmor`) and equal to the digest
# GitHub shows for the asset.
ZIZMOR_VERSION=1.31.1
zizmor_pin() {
  case "$1" in
    Linux/x86_64)                 echo "x86_64-unknown-linux-gnu d185f726bdaf92df78273217dfdd24ebcd6b0ef48cf3ce776ff5762b6e138c99" ;;
    Linux/aarch64 | Linux/arm64)  echo "aarch64-unknown-linux-gnu 37eebbd5762a44f262d94875431b14a6d2402991e90a685113ea97b8b41be833" ;;
    Darwin/arm64)                 echo "aarch64-apple-darwin ad5aa633cd56215b11e6c51d51f90c7e6b22904a75047d1215abbd422f61d698" ;;
    Darwin/x86_64)                echo "x86_64-apple-darwin 72ae63bb85b67229c06242f04195cb43927e9fab5f43803c6434dc701a517d61" ;;
  esac
}

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

platform="$(uname -s)/$(uname -m)"
pin=$(zizmor_pin "$platform")
if [ -z "$pin" ]; then
  ga2_skip "no zizmor $ZIZMOR_VERSION archive is pinned for $platform (docs/conventions/security-workflow.md § Pinned scanners)"
fi
target=${pin%% *} sha256=${pin#* }

if [ -n "${XDG_CACHE_HOME:-}" ]; then
  cache=$XDG_CACHE_HOME/harness/zizmor/$ZIZMOR_VERSION
elif [ -n "${HOME:-}" ]; then
  cache=$HOME/.cache/harness/zizmor/$ZIZMOR_VERSION
else
  cache=""
fi
fetch_offline=""
offline && fetch_offline=1

bin=$(mktemp -d)
trap 'rm -rf "$bin"' EXIT
rc=0
FETCH_PINNED_CACHE=$cache FETCH_PINNED_OFFLINE=$fetch_offline \
  bash "$(dirname "$0")/../fetch-pinned-release.sh" zizmorcore/zizmor "v$ZIZMOR_VERSION" \
  "zizmor-$target.tar.gz" "$sha256" zizmor "$bin" || rc=$?
case "$rc" in
  0) ;;
  3)
    fail "GA-2: the zizmor $ZIZMOR_VERSION archive for $target does not match its pinned sha256 (above) — a substituted or damaged archive, or a wrong pin; nothing was run"
    finish
    ;;
  4)
    if offline; then
      ga2_skip "zizmor $ZIZMOR_VERSION is not in the local cache (run the gate once without --offline)"
    fi
    ga2_skip "zizmor $ZIZMOR_VERSION could not be downloaded from its GitHub release"
    ;;
  *)
    fail "GA-2: zizmor $ZIZMOR_VERSION could not be installed (fetch-pinned-release.sh exit $rc, see above)"
    finish
    ;;
esac

if ! "$bin/zizmor" --version >/dev/null 2>&1; then
  ga2_skip "the pinned zizmor $ZIZMOR_VERSION ($target) does not run on this machine"
fi

rc=0
"$bin/zizmor" --offline .github/workflows/ || rc=$?
case "$rc" in
  0) ok "GA-2: zizmor $ZIZMOR_VERSION reports nothing" ;;
  10|11|12|13|14) fail "GA-2: zizmor $ZIZMOR_VERSION reports findings (above) — fix them, or record the triage in .github/zizmor.yml with its justification" ;;
  *) fail "GA-2: zizmor $ZIZMOR_VERSION itself failed (exit $rc, see above)" ;;
esac

finish
