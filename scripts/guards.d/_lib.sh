# Helpers shared by the guards. Source this file, report with ok / fail / note,
# and end with `finish` (exit 1 if anything failed). `skip` leaves at once with
# the "skipped" exit code the gate understands.
#
# A guard that needs a tool or the network must not pass silently without it:
# call `skip` locally, and `fail` when $CI is set and the check is mandatory.
failures=0
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  _g=$'\033[32m'; _r=$'\033[31m'; _y=$'\033[33m'; _n=$'\033[0m'
else
  _g=""; _r=""; _y=""; _n=""
fi
ok()   { printf '  %sok%s    %s\n' "$_g" "$_n" "$1"; }
fail() { printf '  %sFAIL%s  %s\n' "$_r" "$_n" "$1" >&2; failures=$((failures + 1)); }
note() { printf '  %snote%s  %s\n' "$_y" "$_n" "$1"; }
skip() { printf '  %sskip%s  %s\n' "$_y" "$_n" "$1"; exit 77; }
finish() { [ "$failures" -eq 0 ]; exit $?; }
in_git() { git rev-parse --is-inside-work-tree >/dev/null 2>&1; }
offline() { [ "${HARNESS_OFFLINE:-false}" = true ]; }
