// node --test scripts/eco-design-audit.test.mjs — what scripts/eco-design-audit.mjs
// audits, what it charges to a change, what it leaves out and how it reports.
// The audit itself is a stand-in written here, in the output format of
// green-claude's eco-audit.sh: these tests need no network and no checkout of
// the plugin. Git runs without the user's configuration.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "eco-design-audit.mjs");
const ENV = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GIT_|GITHUB_|GREEN_CLAUDE_|NODE_TEST_CONTEXT$)/.test(k))),
  CI: "", GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid",
};
const write = (dir, rel, text, mode) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
  if (mode) chmodSync(join(dir, rel), mode);
};

// The stand-in: ECO-T-01 (High) on a line holding BAD, ECO-T-02 (Low) on a
// file holding WARN, a crash on CRASH. It refuses to run next to the detector
// that runs a command, or with a GREEN_CLAUDE_ variable of the caller.
const FAKE_AUDIT = `#!/bin/bash
set -euo pipefail
here="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
[ -f "$here/detect-runs.awk" ] && { echo "a detector that runs a command is still there" >&2; exit 9; }
[ -n "\${GREEN_CLAUDE_SOURCE_FILE:-}" ] && { echo "GREEN_CLAUDE_SOURCE_FILE reached the audit" >&2; exit 8; }
n=0; hidden=0
for f in "$@"; do
  [ -f "$f" ] || continue
  if grep -q CRASH "$f"; then echo "cannot read $f" >&2; exit 3; fi
  if grep -q BAD "$f"; then
    if [ -f .green-claude/decisions.md ] && grep -qF "ECO-T-01 \${f#./} ACCEPTED" .green-claude/decisions.md; then
      hidden=$((hidden + 1))
    else
      printf '[High] ECO-T-01 — Bad pattern\\n  File           : %s\\n  Line           : %s\\n  Category       : 1. Test\\n  RGESN          : 1.1\\n  Recommendation : Do the cheap thing\\n\\n' "$f" "$(grep -n BAD "$f" | head -1)"
      n=$((n + 1))
    fi
  fi
  if grep -q WARN "$f"; then
    printf '[Low] ECO-T-02 — Small thing\\n  File           : %s\\n  Category       : 1. Test\\n  RGESN          : 2.2\\n  Recommendation : Maybe lighter\\n  Instead of     : a\\n                   b\\n  Write          : c\\n  Note           : a candidate\\n\\n' "$f"
    n=$((n + 1))
  fi
done
total=$n
[ "\${FAKE_MISCOUNT:-}" = 1 ] && total=$((n + 1))
if [ "$total" -eq 0 ]; then echo "No ecodesign issue found in the files analysed."; else echo "$total ecodesign issue(s) found."; fi
[ "$hidden" -gt 0 ] && echo "$hidden finding(s) hidden by decisions recorded in .green-claude/decisions.md."
exit 0
`;

function fakeSkill(root) {
  const s = join(root, "green-claude", "skills", "green-claude");
  write(s, "scripts/eco-audit.sh", FAKE_AUDIT, 0o755);
  write(s, "scripts/audit-common.sh", "# routing helpers\n");
  write(s, "scripts/detect-safe.awk", '# counts\n{ if ($0 ~ /x/) printf "%d:%s\\n", NR, $0 }\n');
  write(s, "scripts/detect-runs.awk", '# checks that a path exists\n{ cmd = "test -e " $0; cmd | getline r; close(cmd) }\n');
  // The shape of green-claude's catalogues at the pinned commit: `categories`
  // is an object keyed by family. The language file uses an array, which its
  // audit (jq `.categories[]`) reads too.
  write(s, "rules/ecoconception.json", JSON.stringify({ metadata: { name: "test" }, categories: { test: { name: "1. Test", description: "", rules: [
    { id: "ECO-T-01", impact: "High", extensions: ["py", "html"] },
    { id: "ECO-T-03", impact: "Medium", detector: "runs", extensions: ["html"] },
    { id: "ECO-T-04", impact: "Low", detector: "safe", extensions: ["html"] },
  ] } } }));
  write(s, "rules/langages/python.json", JSON.stringify({ metadata: { extensions: ["py"] }, categories: [{ name: "Python", rules: [{ id: "ECO-PY-T", impact: "Low", patterns: ["x"] }] }] }));
  return s;
}

function repo(files, config = {}) {
  const root = mkdtempSync(join(tmpdir(), "eco-design-test-"));
  const dir = join(root, "proj");
  mkdirSync(dir);
  const git = (...args) => {
    const r = spawnSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: dir, env: ENV, encoding: "utf8" });
    assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  git("init", "-q", "-b", "main");
  write(dir, "scripts/eco-design.config.json", JSON.stringify({ repository: "owner/green-claude", commit: "c".repeat(40), fail_on: "none", ...config }));
  for (const [p, t] of Object.entries(files)) write(dir, p, t);
  git("add", "-A");
  git("commit", "-qm", "base");
  const commit = (changes) => { for (const [p, t] of Object.entries(changes)) write(dir, p, t); git("add", "-A"); git("commit", "-qm", "change"); };
  return { root, dir, git, commit, base: git("rev-parse", "HEAD"), skill: fakeSkill(root) };
}

function audit(r, args, env = {}) {
  const summary = join(r.root, `summary-${Math.random().toString(36).slice(2)}.md`);
  const res = spawnSync(process.execPath, [SCRIPT, "--green-claude", r.skill, ...args], {
    cwd: r.dir, encoding: "utf8", env: { ...ENV, GITHUB_ACTIONS: "true", GITHUB_STEP_SUMMARY: summary, ...env },
  });
  return { code: res.status, out: res.stdout, err: res.stderr, summary: existsSync(summary) ? readFileSync(summary, "utf8") : "" };
}

test("a finding the change adds is reported; one the file already had is not", () => {
  const r = repo({ "a.py": "ok\nBAD\n", "b.py": "fine\n" });
  r.commit({ "a.py": "ok\nBAD\nmore\n", "b.py": "fine\nBAD\n" });
  const a = audit(r, ["--base", r.base]);
  assert.equal(a.code, 0, a.err);
  assert.match(a.out, /^::warning file=b\.py,line=2,title=ECO-T-01 \(High\)::Bad pattern\. Do the cheap thing$/m);
  assert.doesNotMatch(a.out, /file=a\.py/);
  assert.match(a.summary, /\*\*1 new finding\(s\)\*\* in the 2 file\(s\)/);
  assert.match(a.summary, /\| High \| ECO-T-01 \| ` b\.py ` \| 2 \|/);
  assert.match(a.summary, /CC BY 4\.0/);
  assert.equal(r.git("worktree", "list").split("\n").length, 1, "the checkout of the base is removed");
});

test("a renamed file keeps what it had; an added file brings its own", () => {
  const r = repo({ "old.py": "line one\nline two\nBAD\nline four\n" });
  r.git("mv", "old.py", "new.py");
  r.commit({ "c.py": "WARN\n" });
  const a = audit(r, ["--base", r.base]);
  assert.equal(a.code, 0, a.err);
  assert.match(a.out, /::warning file=c\.py,title=ECO-T-02 \(Low\)::/);
  assert.doesNotMatch(a.out, /ECO-T-01/);
});

test("a file of a kind the rules do not cover is not audited", () => {
  const r = repo({ "notes.txt": "fine\n" });
  r.commit({ "notes.txt": "BAD\n" });
  const a = audit(r, ["--base", r.base]);
  assert.equal(a.code, 0, a.err);
  assert.match(a.summary, /Nothing to audit/);
});

test("fail_on: a new finding at or above the level fails the check, one below it does not", () => {
  const low = repo({ "a.py": "ok\n" }, { fail_on: "high" });
  low.commit({ "a.py": "WARN\n" });
  const l = audit(low, ["--base", low.base]);
  assert.equal(l.code, 0, l.err);
  assert.match(l.out, /^::warning file=a\.py/m);

  const high = repo({ "a.py": "ok\n" }, { fail_on: "high" });
  high.commit({ "a.py": "BAD\n" });
  const h = audit(high, ["--base", high.base]);
  assert.equal(h.code, 1);
  assert.match(h.out, /^::error file=a\.py,line=1,title=ECO-T-01 \(High\)::/m);
  assert.match(h.err, /at or above fail_on high/);
  assert.match(h.summary, /the check fails/);

  const any = repo({ "a.py": "ok\n" }, { fail_on: "LOW" });
  any.commit({ "a.py": "WARN\n" });
  assert.equal(audit(any, ["--base", any.base]).code, 1, "fail_on is read in any case");
});

test("a detector that runs a command is left out of a copy, and its rule is named", () => {
  const r = repo({ "a.py": "ok\n" });
  r.commit({ "a.py": "BAD\n" });
  const a = audit(r, ["--base", r.base]);
  assert.equal(a.code, 0, a.err);
  assert.match(a.summary, /Not audited: ECO-T-03\. The detector behind it \(` detect-runs\.awk `\) can run a command/);
  assert.doesNotMatch(a.summary, /ECO-T-04/);
  assert.ok(existsSync(join(r.skill, "scripts", "detect-runs.awk")), "the checkout is left as it is");
});

test("an audit that cannot run, or a report that cannot be read, fails the check", () => {
  const r = repo({ "a.py": "ok\n" });
  r.commit({ "a.py": "CRASH\n" });
  const a = audit(r, ["--base", r.base]);
  assert.equal(a.code, 1);
  assert.match(a.err, /the audit did not run: eco-audit\.sh exited with 3: cannot read/);
  assert.match(a.out, /^::error title=Eco-design audit::the audit did not run/m);

  const m = repo({ "a.py": "ok\n" });
  m.commit({ "a.py": "BAD\n" });
  const b = audit(m, ["--base", m.base], { FAKE_MISCOUNT: "1" });
  assert.equal(b.code, 1);
  assert.match(b.err, /announced 2 finding\(s\) and 1 could be read/);
});

test("a decision hides a finding, is counted, and a change to the decisions is pointed out", () => {
  const r = repo({ "a.py": "ok\n" }, { fail_on: "high" });
  r.commit({ "a.py": "BAD\n", ".green-claude/decisions.md": "ECO-T-01 a.py ACCEPTED measured, below the budget\n" });
  const a = audit(r, ["--base", r.base]);
  assert.equal(a.code, 0, a.err);
  assert.match(a.summary, /No new finding/);
  assert.match(a.summary, /1 finding\(s\) hidden by `\.green-claude\/decisions\.md`/);
  assert.match(a.summary, /This change edits ` \.green-claude\/decisions\.md `: a decision there silences a finding/);
});

test("a symbolic link is not followed", () => {
  const r = repo({ "a.py": "ok\n" });
  write(r.root, "outside.py", "BAD\n");
  symlinkSync(join(r.root, "outside.py"), join(r.dir, "link.py"));
  r.commit({});
  const a = audit(r, ["--base", r.base]);
  assert.equal(a.code, 0, a.err);
  assert.match(a.summary, /Nothing to audit/);
});

test("--all lists every finding and fails on nothing", () => {
  const r = repo({ "a.py": "BAD\n", "b.py": "WARN\n", "c.txt": "BAD\n" }, { fail_on: "low" });
  const a = audit(r, ["--all"]);
  assert.equal(a.code, 0, a.err);
  assert.match(a.summary, /## Eco-design inventory/);
  assert.match(a.summary, /2 finding\(s\) in the 2 tracked file\(s\)/);
  assert.doesNotMatch(a.out, /^::(warning|error)/m, "an inventory makes no annotation");
});

test("what a file holds cannot become a workflow command or markup", () => {
  const r = repo({ "a.py": "ok\n" });
  r.commit({ "we,ird:name.py": "BAD\n" });
  const a = audit(r, ["--base", r.base]);
  assert.equal(a.code, 0, a.err);
  assert.match(a.out, /^::warning file=we%2Cird%3Aname\.py,line=1,/m);
  const lines = a.out.split("\n");
  const stop = lines.findIndex((l) => l.startsWith("::stop-commands::"));
  assert.ok(stop > 0, "the plain report is printed with workflow commands off");
  assert.equal(lines.at(-2), `::${lines[stop].slice("::stop-commands::".length)}::`, "and they are back on after it");
  assert.match(a.out, /\[High\] ECO-T-01 we,ird:name\.py:1 — Bad pattern/);
});

test("the caller's GREEN_CLAUDE_ variables do not reach the audit", () => {
  const r = repo({ "a.py": "ok\n" });
  r.commit({ "a.py": "BAD\n" });
  assert.equal(audit(r, ["--base", r.base], { GREEN_CLAUDE_SOURCE_FILE: "elsewhere.py" }).code, 0);
});

test("outside GitHub Actions: the plain report only", () => {
  const r = repo({ "a.py": "ok\n" });
  r.commit({ "a.py": "BAD\n" });
  const a = audit(r, ["--base", r.base], { GITHUB_ACTIONS: "" });
  assert.equal(a.code, 0, a.err);
  assert.doesNotMatch(a.out, /^::/m);
  assert.equal(a.summary, "");
  assert.match(a.out, /1 new finding\(s\)/);
});

test("arguments and settings that do not hold stop the run", () => {
  const r = repo({ "a.py": "ok\n" });
  assert.match(audit(r, []).err, /give either --base <commit> or --all/);
  assert.match(audit(r, ["--all", "--base", r.base]).err, /give either/);
  assert.match(audit(r, ["--base"]).err, /--base needs a value/);
  const bad = repo({ "a.py": "ok\n" }, { fail_on: "sometimes" });
  const a = audit(bad, ["--all"]);
  assert.equal(a.code, 1);
  assert.match(a.err, /fail_on is none, low, medium or high/);
  const res = spawnSync(process.execPath, [SCRIPT, "--green-claude", r.root, "--all"], { cwd: r.dir, env: ENV, encoding: "utf8" });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /is not the skills\/green-claude directory of a green-claude checkout/);
});
