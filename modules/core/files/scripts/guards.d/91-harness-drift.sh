#!/usr/bin/env bash
# HD-1 — advisory: which kit files differ from the hash they were installed
# with (docs/conventions/local-gate.md § Kit files and their hashes). Never
# fails: a project may edit a kit file, but a reviewer should know which ones
# are no longer what the kit shipped.
#   HD-1  every file .claude/harness.json records with a sha256 (the kit-owned
#         ones; seeds carry none) is hashed and compared. A file that still
#         matches was reviewed in the kit; one that differs, or is gone, is the
#         project's to review.
# Needs no kit checkout and no Node: awk reads the manifest in the layout the
# installer writes (two-space JSON), sha256sum or shasum hashes the files.
# The manifest is the reference, so this proves nothing about a change that
# rewrites the manifest itself — an installation or an update of the kit is
# checked against the kit (same page).
. "$(dirname "$0")/_lib.sh"

manifest=.claude/harness.json
[ -f "$manifest" ] || skip "HD-1: no $manifest — not installed by the kit, nothing to compare"

if command -v sha256sum >/dev/null 2>&1; then
  hash_of() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
  hash_of() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
  skip "HD-1: neither sha256sum nor shasum found"
fi

# One "<sha256><TAB><path>" line per kit-owned file of the "files" object.
entries=$(awk '
  /^  "files": [{]$/ { in_files = 1; next }
  in_files && /^  [}]/ { in_files = 0 }
  !in_files { next }
  /^    "[^"]+": [{]$/ { path = $0; sub(/^    "/, "", path); sub(/": [{]$/, "", path); next }
  /^      "sha256": "[0-9a-f]+"/ { hash = $0; sub(/^      "sha256": "/, "", hash); sub(/".*$/, "", hash); print hash "\t" path }
' "$manifest")

if [ -z "$entries" ]; then
  note "HD-1: no hashed file could be read from $manifest (not in the layout the installer writes?) — nothing compared"
  finish
fi

same=0
differ=""
while IFS=$'\t' read -r recorded path; do
  if [ ! -f "$path" ]; then
    differ="$differ          $path  (missing)"$'\n'
  elif [ "$(hash_of "$path")" != "$recorded" ]; then
    differ="$differ          $path"$'\n'
  else
    same=$((same + 1))
  fi
done <<< "$entries"

if [ -n "$differ" ]; then
  note "HD-1: $(printf '%s' "$differ" | grep -c .) kit file(s) differ from the hash recorded in $manifest — edited here, to review here:"
  printf '%s' "$differ"
fi
ok "HD-1: $same kit file(s) identical to the hash they were installed with"

finish
