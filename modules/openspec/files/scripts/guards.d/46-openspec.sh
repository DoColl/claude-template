#!/usr/bin/env bash
# OS-1 — the OpenSpec artefacts are valid (docs/conventions/openspec-workflow.md).
#   OS-1  `openspec validate --all --strict --no-interactive` passes: every spec
#         and every change in flight has the shape the workflow relies on.
# Skipped when there is nothing to validate yet. Without the CLI on the PATH:
# skipped on a laptop and when the gate runs offline; on a CI runner the guard
# installs the version pinned beside it (46-openspec/package-lock.json: every
# package with its integrity hash) with `npm ci --ignore-scripts`, outside the
# project's tree, and fails when it cannot — there the check is mandatory.
. "$(dirname "$0")/_lib.sh"

pin="$(dirname "$0")/46-openspec"

if [ ! -d openspec ]; then
  skip "OS-1: no openspec/ directory yet — run \`openspec init\`"
fi

specs=$(find openspec/specs -name spec.md 2>/dev/null | head -n 1)
changes=$(find openspec/changes -mindepth 1 -maxdepth 1 -type d ! -name archive 2>/dev/null | head -n 1)
if [ -z "$specs" ] && [ -z "$changes" ]; then
  skip "OS-1: no spec and no change in flight yet"
fi

os1_mandatory() {
  fail "OS-1: $1 — OS-1 is mandatory on a CI runner"
  finish
}

if command -v openspec >/dev/null 2>&1; then
  set -- openspec
elif [ -z "${CI:-}" ]; then
  skip "OS-1: the openspec CLI is not installed"
elif offline; then
  # A push hook on a runner runs the gate offline; the run without --offline,
  # the one CI enforces, is where the pinned CLI is installed.
  skip "OS-1: the openspec CLI is not installed, and installing the pinned one needs the network"
else
  if [ ! -f "$pin/package.json" ] || [ ! -f "$pin/package-lock.json" ]; then
    os1_mandatory "the CLI is not installed and its pin ($pin/) is missing"
  fi
  if ! command -v npm >/dev/null 2>&1; then
    os1_mandatory "the CLI is not installed and npm is not there to install the pinned one"
  fi
  # Installed in a directory of its own: nothing is written in the project's
  # tree, and the project's .npmrc is not read.
  cli_dir=$(mktemp -d) || os1_mandatory "no temporary directory to install the pinned CLI in"
  trap 'rm -rf "$cli_dir"' EXIT
  cp "$pin/package.json" "$pin/package-lock.json" "$cli_dir/"
  if ! out=$(cd "$cli_dir" && npm ci --ignore-scripts --no-audit --no-fund 2>&1); then
    printf '%s\n' "$out" | tail -n 30 >&2
    os1_mandatory "npm ci could not install the pinned CLI (see above)"
  fi
  if [ ! -x "$cli_dir/node_modules/.bin/openspec" ]; then
    os1_mandatory "npm ci left no openspec command in the pinned install"
  fi
  set -- "$cli_dir/node_modules/.bin/openspec"
fi

if out=$(OPENSPEC_TELEMETRY=0 "$@" validate --all --strict --no-interactive 2>&1); then
  ok "OS-1: openspec validate passes"
else
  printf '%s\n' "$out" | tail -n 30 >&2
  fail "OS-1: openspec validate --all --strict fails (see above)"
fi

finish
