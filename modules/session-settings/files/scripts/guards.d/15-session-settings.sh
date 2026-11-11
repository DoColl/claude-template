#!/usr/bin/env bash
# SS-1..3 — .claude/settings.json (docs/conventions/session-settings.md). The
# file is loaded by every session opened in the repository, before any
# instruction is read: what it grants, every session has.
#   SS-1  it is valid JSON and still denies reading `.env` and `.env.*`. A
#         carve-out (`Read(!…)`) names one file, never `.env` itself and never
#         a wildcard: each one reopens a file to every session.
#   SS-2  it grants nothing wholesale: no `bypassPermissions` as the default
#         mode, no allow rule for all of Bash or PowerShell, no blanket
#         approval of the project's MCP servers, no `disableAllHooks` (a hook
#         is how a rule is enforced rather than asked for). A sandbox turned off,
#         or one that drops the prompt for sandboxed commands, is a note: the
#         project may decide it, a reviewer should see it.
#   SS-3  `.claude/settings.local.json` is not tracked, at any depth: it holds
#         one person's own allow rules, and tracked it applies to everyone.
# Needs node to read JSON: without it the guard skips locally and fails on a
# runner.
. "$(dirname "$0")/_lib.sh"

f=.claude/settings.json
if [ ! -f "$f" ]; then
  fail "SS-1: $f is missing"
  finish
fi
if ! command -v node >/dev/null 2>&1; then
  if [ -n "${CI:-}" ]; then fail "SS-1: node is needed to read $f"; finish; fi
  skip "SS-1: node not found — $f was not checked"
fi

out=$(node -e '
const fs = require("fs");
const say = (kind, msg) => console.log(kind + "\t" + msg);
let s;
try { s = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch (e) { say("fail", "SS-1: " + process.argv[1] + " is not valid JSON: " + e.message); process.exit(0); }
if (s === null || typeof s !== "object" || Array.isArray(s)) { say("fail", "SS-1: " + process.argv[1] + " must hold a JSON object"); process.exit(0); }
const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
const perms = s.permissions && typeof s.permissions === "object" ? s.permissions : {};
const deny = list(perms.deny), allow = list(perms.allow);

// SS-1
const reads = deny.map((r) => /^Read\((.*)\)$/.exec(r)).filter(Boolean).map((m) => m[1]);
const names = (p) => p.replace(/^(\.\/|\*\*\/)/, "");
let bad1 = 0;
for (const want of [".env", ".env.*"]) {
  if (!reads.some((p) => !p.startsWith("!") && names(p) === want)) { say("fail", "SS-1: permissions.deny no longer holds Read(" + want + ")"); bad1++; }
}
const carved = reads.filter((p) => p.startsWith("!")).map((p) => p.slice(1));
for (const p of carved) {
  if (/[*?\[]/.test(p) || /(^|\/)\.env$/.test(p) || p.endsWith("/")) { say("fail", "SS-1: the carve-out Read(!" + p + ") reopens more than one named file"); bad1++; }
}
if (!bad1) say("ok", "SS-1: reading .env and .env.* is denied" + (carved.length ? "; carved out, each to be a file without a secret: " + carved.join(", ") : ""));

// SS-2
let bad2 = 0;
if (perms.defaultMode === "bypassPermissions") { say("fail", "SS-2: permissions.defaultMode is bypassPermissions — every session would skip every prompt"); bad2++; }
for (const r of allow) {
  if (/^(Bash|PowerShell)(\(\s*:?\*{0,2}\s*\))?$/.test(r)) { say("fail", "SS-2: permissions.allow holds " + r + " — every shell command, for every session"); bad2++; }
}
if (s.enableAllProjectMcpServers === true) { say("fail", "SS-2: enableAllProjectMcpServers approves every server a pull request adds to .mcp.json"); bad2++; }
if (s.disableAllHooks === true) { say("fail", "SS-2: disableAllHooks turns off every hook of the repository, for every session"); bad2++; }
if (!bad2) say("ok", "SS-2: no bypass mode, no blanket shell allow, no blanket MCP approval, hooks left on");
const sb = s.sandbox && typeof s.sandbox === "object" ? s.sandbox : {};
if (sb.enabled !== true) say("note", "SS-2: the Bash sandbox is not enabled in " + process.argv[1] + " — shell commands run with the full access of whoever started the session");
else if (sb.autoAllowBashIfSandboxed !== false) say("note", "SS-2: sandboxed shell commands run without a prompt (sandbox.autoAllowBashIfSandboxed is not false)");
' "$f" 2>&1) || true
if [ -z "$out" ]; then
  fail "SS-1: $f could not be checked (node printed nothing)"
fi
while IFS=$'\t' read -r kind msg; do
  case "$kind" in
    ok) ok "$msg" ;;
    note) note "$msg" ;;
    '') ;;
    fail) fail "$msg" ;;
    *) fail "SS-1: unexpected output while checking $f: $kind $msg" ;;
  esac
done <<< "$out"

# SS-3
if in_git; then
  tracked=$(git ls-files -- '.claude/settings.local.json' '*/.claude/settings.local.json')
  if [ -n "$tracked" ]; then
    fail "SS-3: a personal settings file is tracked — git rm --cached it and keep it ignored: $(printf '%s' "$tracked" | tr '\n' ' ')"
  else
    ok "SS-3: no .claude/settings.local.json is tracked"
  fi
else
  note "SS-3: not a git repository — tracked files were not checked"
fi

finish
