#!/usr/bin/env bash
# Download one GitHub release archive, check it against a pinned sha256 and
# unpack a single member of it. security.yml installs every scanner binary
# this way; pins and bump procedure: docs/conventions/security-workflow.md
# § Pinned scanners.
#
# Usage: fetch-pinned-release.sh <owner/repo> <tag> <asset> <sha256> <member> <dest-dir>
#
# Nothing is unpacked unless the hash matches, and only <member> leaves the
# archive (unpacking a whole release tarball in the workspace would write its
# README.md and LICENSE over the repository's own). Written for the CI runner:
# it relies on GNU `sha256sum`.
set -euo pipefail

if [ "$#" -ne 6 ]; then
  echo "usage: $0 <owner/repo> <tag> <asset> <sha256> <member> <dest-dir>" >&2
  exit 2
fi
repo=$1 tag=$2 asset=$3 sha256=$4 member=$5 dest=$6

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

curl -sSfL --retry 3 -o "$work/$asset" "https://github.com/$repo/releases/download/$tag/$asset"
echo "$sha256  $work/$asset" | sha256sum --check --strict -
mkdir -p "$dest"
tar -xzf "$work/$asset" -C "$dest" "$member"
