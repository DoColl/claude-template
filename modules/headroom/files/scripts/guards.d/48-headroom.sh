#!/usr/bin/env bash
# HR-1..3 — Headroom stays on one machine (docs/conventions/headroom.md). The
# proxy sees every prompt and credential of a session routed through it, so
# routing a session through it is each person's decision on their own machine,
# never something a clone or a pull request decides for everyone.
#   HR-1  what is committed (the blobs of the index, what GitHub runs and a
#         clone gets, not the bytes on this disk) neither runs nor reaches
#         Headroom, nor reroutes a session:
#         - no tracked file names headroom or port 8787 (not inside a longer
#           number or word), read as UTF-8 with NUL bytes dropped, backslash
#           line breaks joined (LF, CR, U+0085, U+2028, U+2029) and \u, \x,
#           \U and octal escapes decoded; a symlink is read as its target path.
#           Markdown is read in its frontmatter only (an agent's or a skill's
#           hooks live there, prose does not run), and whole when it holds the
#           dynamic shell context Claude Code runs itself (a bang before a
#           backquoted span or a fenced block); this guard, .gitignore and
#           .claude/harness.json, which name the module, are skipped;
#         - settings files (.claude/settings.json at any depth) are read as
#           JSON: no env entry that moves the API traffic
#           (ANTHROPIC_*BASE_URL, ANTHROPIC_CUSTOM_HEADERS, HTTP_PROXY,
#           HTTPS_PROXY, ALL_PROXY), any host, a deliberate gateway included;
#           the names above anywhere but permissions.deny and permissions.ask;
#         - workflows and composite actions (action.yml): no line naming one
#           of those variables, comments included; no escape spelling a letter,
#           digit or underscore; no NUL byte (UTF-16) and no U+0085, U+2028 or
#           U+2029, which YAML reads as line breaks;
#         - .claude, .mcp.json, .github, action.yml, .claude-plugin and
#           hooks/hooks.json are never a symlink or a submodule, whose content
#           is not in this repository; no tracked path holds U+017F or U+212A,
#           which a case-insensitive filesystem folds onto s and k;
#         - the project is the repository's root: installed in a sub-directory,
#           the root's settings and workflows would go unchecked.
#   HR-2  Headroom's local state is never tracked: .headroom/ (its memory
#         store), the .claude/.headroom_wrap_* sidecars, .claude/settings.local.json
#         and CLAUDE.local.md, at any depth, any case; and the .gitignore block
#         of this module is still there.
#   HR-3  no block written by `headroom learn` (its opening comment) in a
#         committed file: it is distilled from session transcripts by a model,
#         and once committed it instructs every session of every contributor.
# HR-1 needs node: without it the guard runs HR-2 and HR-3, then skips locally
# (or fails, if they failed) and fails on a runner. Outside a git repository
# nothing can be read as committed: a note locally, a failure on a runner.
. "$(dirname "$0")/_lib.sh"

marker='<!-- headroom:learn:'"start"   # split, so that this file holds no marker

if ! in_git; then
  if [ -n "${CI:-}" ]; then fail "HR-1: not a git repository on a runner — the checks read what is committed"
  else note "HR-1..3: not a git repository — nothing committed to check"; fi
  finish
fi
prefix=$(git rev-parse --show-prefix 2>/dev/null)
if [ -n "$prefix" ]; then
  fail "HR-1: this project is $prefix inside a larger repository — the root's settings and workflows are not checked from here; install the kit at the repository root"
fi

# HR-1
no_node=""
if ! command -v node >/dev/null 2>&1; then
  if [ -n "${CI:-}" ]; then fail "HR-1: node is needed to read what is committed"
  else no_node="HR-1: node not found — committed files were not checked"; fi
else
  errs=$(mktemp "${TMPDIR:-/tmp}/hr1.XXXXXX")
  out=$(node -e '
const { execFileSync } = require("child_process");
const say = (kind, msg) => console.log(kind + "\t" + String(msg).replace(/[\t\n\r]/g, " "));
// git writes advice on stderr (a sparse index, for one): keep it out of the verdict.
const git = (args, input) => execFileSync("git", ["-c", "core.quotePath=false", "-c", "advice.sparseIndexExpanded=false", ...args], { input, maxBuffer: 1 << 30, stdio: ["pipe", "pipe", "ignore"] });
// The port anywhere but inside a longer number or word (18787, v1.8787, a hash).
const NAMES = /headroom|(^|[^0-9A-Za-z_.-])0*8787(?![0-9])/i;
const ROUTE = /^(ANTHROPIC_[A-Z0-9_]*BASE_URL|ANTHROPIC_CUSTOM_HEADERS|HTTPS?_PROXY|ALL_PROXY)$/i;
const ROUTE_TEXT = /(^|[^A-Za-z0-9_])(ANTHROPIC_[A-Z0-9_]*BASE_URL|ANTHROPIC_CUSTOM_HEADERS|HTTPS?_PROXY|ALL_PROXY)(?![A-Za-z0-9_])/i;
const ESCAPE = /\\((x|u00|U000000)(3[0-9]|4[1-9A-Fa-f]|5[0-9AaFf]|6[1-9A-Fa-f]|7[0-9Aa])|0?(06[0-7]|07[01]|10[1-7]|1[12][0-7]|13[0-2]|137|14[1-7]|1[56][0-7]|17[0-2]))/;
const OWN = new Set(["scripts/guards.d/48-headroom.sh", ".gitignore", ".claude/harness.json"]);
const SENSITIVE = /(^|\/)(\.claude(\/|$)|\.mcp\.json$|action\.ya?ml$|\.claude-plugin(\/|$)|hooks\/hooks\.json$)|^\.github(\/|$)/i;
const isSettings = (p) => /(^|\/)\.claude\/settings\.json$/i.test(p);
const isYaml = (p) => /^\.github\/workflows\/.+\.ya?ml$/i.test(p) || /(^|\/)action\.ya?ml$/i.test(p);
const isMd = (p) => /\.(md|mdx|markdown)$/i.test(p);
const LIMIT = 20e6;
const cp = (n) => (n <= 0x10ffff ? String.fromCodePoint(n) : "");
// What a reader may make of the text: NULs dropped (UTF-16), lines continued
// by a backslash joined, escapes decoded.
const decode = (t) => t.replace(/\0/g, "")
  .replace(/\\(\r\n|\r|\n|\u0085|\u2028|\u2029)[ \t]*/g, "")
  .replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, (m, h) => cp(parseInt(h, 16)))
  .replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => cp(parseInt(h, 16)))
  .replace(/\\U([0-9a-fA-F]{8})/g, (m, h) => cp(parseInt(h, 16)))
  .replace(/\\x([0-9a-fA-F]{2})/g, (m, h) => cp(parseInt(h, 16)))
  .replace(/\\([0-7]{3})/g, (m, o) => cp(parseInt(o, 8)));
const strings = (v, out = []) => {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.push(k); strings(x, out); }
  return out;
};
const shown = (s) => JSON.stringify(s).slice(0, 80);
let bad = 0;
const fail = (m) => { say("fail", m); bad++; };

const entries = git(["ls-files", "-s", "-z"]).toString("utf8").split("\0").filter(Boolean).map((r) => {
  const tab = r.indexOf("\t"), [mode, sha] = r.slice(0, tab).split(" ");
  return { mode, sha, path: r.slice(tab + 1) };
});
const links = entries.filter((e) => (e.mode === "120000" || e.mode === "160000") && SENSITIVE.test(e.path)).map((e) => e.path);
if (links.length) fail("HR-1: committed as a symlink or a submodule, whose content is not checked here — commit the files themselves: " + links.join(" "));
const folded = entries.filter((e) => /[ſK]/.test(e.path)).map((e) => e.path);
if (folded.length) fail("HR-1: a path holds U+017F or U+212A, which macOS and Windows fold onto s and k — rename it: " + folded.join(" "));

// A symlink is stored as a blob holding its target path: read it like a file.
const files = entries.filter((e) => e.mode === "100644" || e.mode === "100755" || e.mode === "120000");
const sizes = new Map();
if (files.length) for (const line of git(["cat-file", "--batch-check"], files.map((e) => e.sha).join("\n") + "\n").toString().split("\n")) {
  const [sha, type, size] = line.split(" ");
  if (type === "blob") sizes.set(sha, Number(size));
}
const skipped = [];
let read = 0;
const check = (e, buf) => {
  read++;
  const text = buf.toString("utf8");
  if (isSettings(e.path)) {
    let j;
    try { j = JSON.parse(text); } catch (err) { return fail("HR-1: " + e.path + " is not valid JSON, so it cannot be checked: " + err.message); }
    if (!j || typeof j !== "object" || Array.isArray(j)) return fail("HR-1: " + e.path + " must hold a JSON object");
    const env = j.env && typeof j.env === "object" ? j.env : {};
    for (const k of Object.keys(env)) if (ROUTE.test(k)) fail("HR-1: " + e.path + " sets env." + k + " — every session of every clone would send its traffic there");
    for (const [key, v] of Object.entries(j)) {
      // Permission rules may name headroom to deny it, or to ask first.
      const value = key === "permissions" && v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== "deny" && k !== "ask")) : v;
      const hit = strings(value).find((x) => NAMES.test(decode(x)));
      if (hit !== undefined) fail("HR-1: " + e.path + " names Headroom or port 8787 under " + key + " (" + shown(hit) + ")");
    }
    return;
  }
  if (OWN.has(e.path)) return;
  let scanned = text;
  if (isMd(e.path)) {
    // Claude Code runs the dynamic shell context of a command or a skill (a
    // bang before a backquoted span or a fenced block) itself: such a file is
    // read whole. Otherwise the frontmatter only, up to the first line that is
    // three dashes, trailing blanks allowed; with no closing line, all of it.
    const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    if (/!`|```!/.test(body)) scanned = body;
    else if (/^---/.test(body)) { const m = /^---[^\n]*\n([\s\S]*?)\n---[ \t]*\r?(\n|$)/.exec(body); scanned = m ? m[1] : body; }
    else scanned = "";
  }
  const d = decode(scanned);
  if (NAMES.test(d)) fail("HR-1: " + e.path + " names Headroom or port 8787" + (isMd(e.path) ? " in its frontmatter" : "") + " — no committed file starts, configures or reaches it");
  if (isYaml(e.path)) {
    if (text.includes("\0")) fail("HR-1: " + e.path + " holds a NUL byte (UTF-16?) — save it as UTF-8, so that this check reads what GitHub reads");
    if (/[\u0085\u2028\u2029]/.test(text)) fail("HR-1: " + e.path + " holds U+0085, U+2028 or U+2029, which YAML reads as a line break — remove it");
    if (ROUTE_TEXT.test(d)) {
      const lines = text.split(/\r\n|\r|\n/).map((l, i) => (ROUTE_TEXT.test(l) ? i + 1 : 0)).filter(Boolean);
      fail("HR-1: " + e.path + (lines.length ? ", line " + lines.join(" ") : " (once lines are joined and escapes decoded)") + ": names a variable that reroutes API traffic or sets a proxy — refused in every workflow and action, whatever the job (docs/conventions/headroom.md § Not for every project)");
    }
    if (ESCAPE.test(text)) {
      const lines = text.split(/\r\n|\r|\n/).map((l, i) => (ESCAPE.test(l) ? i + 1 : 0)).filter(Boolean);
      fail("HR-1: " + e.path + ", line " + lines.join(" ") + ": an escape spells a letter, digit or underscore — write the name plainly, so that this check can read it");
    }
  }
};
// Blobs in batches, so that a large repository is not held in memory at once.
const wanted = files.filter((e) => { const s = sizes.get(e.sha); if (s === undefined || s > LIMIT) { skipped.push(e.path); return false; } return true; });
// At most 500 blobs or 64 MB per call, whichever comes first.
for (let i = 0; i < wanted.length;) {
  const batch = [];
  let bytes = 0;
  while (i < wanted.length && batch.length < 500 && (batch.length === 0 || bytes + sizes.get(wanted[i].sha) <= 64e6)) { bytes += sizes.get(wanted[i].sha); batch.push(wanted[i++]); }
  const out = git(["cat-file", "--batch"], batch.map((e) => e.sha).join("\n") + "\n");
  let pos = 0;
  for (const e of batch) {
    const nl = out.indexOf(10, pos);
    const head = out.slice(pos, nl).toString().split(" ");
    if (head[0] !== e.sha || head[1] !== "blob") { fail("HR-1: " + e.path + " could not be read from the index (" + head.join(" ") + ")"); break; }
    const size = Number(head[2]);
    check(e, out.subarray(nl + 1, nl + 1 + size));
    pos = nl + 1 + size + 1;
  }
}
if (skipped.length) say("note", "HR-1: not read, over 20 MB or not a blob: " + skipped.join(" "));
if (!bad) say("ok", "HR-1: " + read + " committed file(s) read — none runs, configures or reaches Headroom, none reroutes a session");
' 2>"$errs"); rc=$?
  seen=0
  while IFS=$'\t' read -r kind msg; do
    case "$kind" in
      ok) ok "$msg"; seen=1 ;;
      note) note "$msg" ;;
      fail) fail "$msg"; seen=1 ;;
      '') ;;
      *) fail "HR-1: unexpected output from the check: $kind $msg"; seen=1 ;;
    esac
  done <<< "$out"
  if [ "$rc" -ne 0 ] || [ "$seen" -eq 0 ]; then
    fail "HR-1: the check did not finish (exit $rc): $(head -c 300 "$errs" | tr '\n' ' ')"
  fi
  rm -f "$errs"
fi

# HR-2
state=$(git -c core.quotePath=false -c advice.sparseIndexExpanded=false ls-files -- ':(icase).headroom/*' ':(icase)*/.headroom/*' \
  ':(icase).claude/.headroom_wrap_*' ':(icase)*/.claude/.headroom_wrap_*' \
  ':(icase).claude/settings.local.json' ':(icase)*/.claude/settings.local.json' \
  ':(icase)CLAUDE.local.md' ':(icase)*/CLAUDE.local.md')
if [ -n "$state" ]; then
  fail "HR-2: a file of one machine is tracked — git rm --cached it: $(printf '%s' "$state" | tr '\n' ' ')"
elif ! tr -d '\r' < .gitignore 2>/dev/null | grep -qxF '.headroom/'; then
  fail "HR-2: .gitignore no longer holds the claude-template:headroom block (.headroom/) — put it back"
else
  ok "HR-2: no Headroom state, personal settings or CLAUDE.local.md is tracked"
fi

# HR-3 — in what is committed, not in the bytes on this disk
found=$(git -c core.quotePath=false -c advice.sparseIndexExpanded=false grep --cached -l -F -e "$marker" 2>&1); rc=$?
case "$rc" in
  0) fail "HR-3: a block written by headroom learn is in a shared file — move it to CLAUDE.local.md or drop it: $(printf '%s' "$found" | tr '\n' ' ')" ;;
  1) ok "HR-3: no headroom learn block in a committed file" ;;
  *) fail "HR-3: the search for a headroom learn block failed: $found" ;;
esac

# Without node, HR-1 was not done: say so once the other checks have run.
if [ -n "$no_node" ] && [ "$failures" -eq 0 ]; then skip "$no_node"; fi
[ -n "$no_node" ] && note "$no_node"
finish
