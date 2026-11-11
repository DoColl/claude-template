#!/usr/bin/env bash
# Project regression checks — one per finding in SECURITY_REVIEW.md.
#
# Each check carries the ID of its finding, so a failure says what regressed
# and where its story is. Keep them cheap (grep-level, a small script at most):
# the point is that a fixed bug cannot quietly come back, not to re-test it.
# This file is yours: the kit never overwrites it.
. "$(dirname "$0")/_lib.sh"

# Shape of a check (delete the example once you have a real one):
#
#   # H1 — exports go through the CSV sanitizer (SECURITY_REVIEW.md § H1)
#   if grep -rnE 'join\(","\)' src/exports --include='*.ts' | grep -v csvRow; then
#     fail "H1: an export builds a CSV line without csvRow()"
#   else
#     ok "H1: exports use the CSV sanitizer"
#   fi

note "no project regression check yet — TODO(harness): add one per fixed finding"

finish
