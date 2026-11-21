#!/usr/bin/env bash
# Download one GitHub release archive, check it against a pinned sha256 and
# unpack a single member of it. security.yml installs every scanner binary
# this way, and GA-2 (scripts/guards.d/30-github-actions.sh) installs zizmor;
# pins and bump procedure: docs/conventions/security-workflow.md § Pinned
# scanners.
#
# Usage: fetch-pinned-release.sh <owner/repo> <tag> <asset> <sha256> <member> <dest-dir>
#
# Nothing is unpacked unless the hash matches, and only <member> leaves the
# archive (unpacking a whole release tarball in the workspace would write its
# README.md and LICENSE over the repository's own). Uses `sha256sum`, or
# `shasum -a 256` where it is absent (older macOS).
#
# Optional environment:
#   FETCH_PINNED_CACHE=<dir>  keep the archive as <dir>/<asset> and reuse it.
#       A cached archive is checked against the pin on every call, exactly
#       like a fresh download, so a cache someone altered fails; only an
#       archive that matched is ever written there. An asset name does not
#       always carry the version: give each tag a directory of its own.
#   FETCH_PINNED_OFFLINE=1    never download: the cached archive, or nothing.
#
# Exit codes: 0 unpacked; 2 usage; 3 the archive does not match the pin;
# 4 the archive is not available (the download failed, or offline with
# nothing cached); anything else, a failure of its own (tar, a missing tool).
set -euo pipefail

if [ "$#" -ne 6 ]; then
  echo "usage: $0 <owner/repo> <tag> <asset> <sha256> <member> <dest-dir>" >&2
  exit 2
fi
repo=$1 tag=$2 asset=$3 sha256=$4 member=$5 dest=$6

if ! printf '%s\n' "$sha256" | grep -qxE '[0-9a-f]{64}'; then
  echo "fetch-pinned-release: the pin is not 64 lowercase hex digits: $sha256" >&2
  exit 2
fi
case "$asset" in
  "" | . | .. | */*) echo "fetch-pinned-release: not an asset name: $asset" >&2; exit 2 ;;
esac

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# The archive checked is the one unpacked: a cached copy is first copied into
# the private work directory, so it cannot change between the two.
archive=$work/$asset
cache=${FETCH_PINNED_CACHE:-}
fresh=false
if [ -n "$cache" ] && [ -f "$cache/$asset" ]; then
  cp "$cache/$asset" "$archive"
elif [ "${FETCH_PINNED_OFFLINE:-}" = 1 ]; then
  echo "fetch-pinned-release: offline, and $asset is not cached" >&2
  exit 4
else
  fresh=true
  if ! curl -sSfL --retry 3 -o "$archive" "https://github.com/$repo/releases/download/$tag/$asset"; then
    echo "fetch-pinned-release: could not download $asset of $repo $tag" >&2
    exit 4
  fi
fi

actual=$(sha256_of "$archive")
if [ "$actual" != "$sha256" ]; then
  if [ "$fresh" = true ]; then
    echo "fetch-pinned-release: the $asset just downloaded does not match its pin" >&2
  else
    echo "fetch-pinned-release: $cache/$asset does not match its pin" >&2
  fi
  echo "  pinned:   $sha256" >&2
  echo "  computed: $actual" >&2
  exit 3
fi

if [ -n "$cache" ] && [ "$fresh" = true ]; then
  # Written beside its final name, then renamed: two gates filling the cache
  # at once never leave a half-written archive behind.
  mkdir -p "$cache"
  part=$(mktemp "$cache/.partial.XXXXXX")
  cp "$archive" "$part"
  mv -f "$part" "$cache/$asset"
fi

mkdir -p "$dest"
tar -xzf "$archive" -C "$dest" "$member"
