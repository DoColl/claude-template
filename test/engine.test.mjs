// node --test test/*.test.mjs — the installer's pure parts, the static rules every module must satisfy
// (docs/module-authoring.md) and the kit's changelog fragments. The end-to-end installs, and a release cut in a
// copy of the kit, are in install.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadKit, resolveSelection, listModules, PHASES } from "../lib/kit.mjs";
import { walk } from "../lib/install.mjs";
import { render, tokensIn, insertAtSlot, slotsIn, appendBlock } from "../lib/render.mjs";
import { parseEntries } from "../lib/changelog.mjs";
import { LEVELS, parseFragment, readFragments, highestLevel, nextVersion, composeEntry, insertEntry, setVersion } from "../lib/release.mjs";

const kit = loadKit();
const read = (...p) => fs.readFileSync(path.join(...p), "utf8");
const closureOf = (id) => resolveSelection(kit, [id]);

// ── text operations ─────────────────────────────────────────────────────────
test("render replaces declared placeholders and refuses unknown ones", () => {
  assert.equal(render("a __HARNESS_X__ b __HARNESS_LONG_KEY_2__", { X: "1", LONG_KEY_2: "two" }, "t"), "a 1 b two");
  assert.throws(() => render("__HARNESS_NOPE__", {}, "file.md"), /file\.md: placeholder __HARNESS_NOPE__/);
  assert.equal(render("${{ github.token }} {{ x }} __OTHER__", {}, "t"), "${{ github.token }} {{ x }} __OTHER__", "GitHub expressions and other tokens are left alone");
  assert.deepEqual(tokensIn("__HARNESS_A__ __HARNESS_B_C__ __HARNESS_A__"), ["A", "B_C"]);
});

test("insertAtSlot: a block gets a blank line, rows do not, the marker stays", () => {
  const doc = "# T\n<!-- harness:slot intro -->\n| a |\n|---|\n<!-- harness:rows table -->\nend\n";
  assert.equal(insertAtSlot(doc, "intro", "para\n\n"), "# T\npara\n\n<!-- harness:slot intro -->\n| a |\n|---|\n<!-- harness:rows table -->\nend\n");
  assert.equal(insertAtSlot(doc, "table", "| 1 |\n| 2 |\n"), "# T\n<!-- harness:slot intro -->\n| a |\n|---|\n| 1 |\n| 2 |\n<!-- harness:rows table -->\nend\n");
  assert.equal(insertAtSlot(doc, "absent", "x"), null);
  assert.throws(() => insertAtSlot(doc, "Bad Name", "x"));
});

test("insertAtSlot does not confuse a slot with one whose name it prefixes", () => {
  const doc = "<!-- harness:rows conventions-index -->\n<!-- harness:rows conventions -->\n";
  assert.equal(insertAtSlot(doc, "conventions", "- x"), "<!-- harness:rows conventions-index -->\n- x\n<!-- harness:rows conventions -->\n");
  assert.deepEqual(slotsIn(doc), ["conventions-index", "conventions"]);
  assert.equal(insertAtSlot("# harness:slot a\n", "a", "x: 1"), "x: 1\n\n# harness:slot a\n", "any comment syntax");
});

test("appendBlock appends once, whatever the file ends with", () => {
  const once = appendBlock("node_modules/\n", "kit", "a\nb\n");
  assert.equal(once.text, "node_modules/\n\n# >>> kit\na\nb\n# <<< kit\n"); assert.equal(once.changed, true);
  assert.deepEqual(appendBlock(once.text, "kit", "different"), { text: once.text, changed: false });
  assert.equal(appendBlock("", "kit", "a").text, "# >>> kit\na\n# <<< kit\n");
  assert.equal(appendBlock("x", "kit", "a").text, "x\n\n# >>> kit\na\n# <<< kit\n");
});

// ── kit loading ─────────────────────────────────────────────────────────────
function fixtureKit(modules) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-kit-"));
  fs.writeFileSync(path.join(root, "kit.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }));
  for (const [id, manifest] of Object.entries(modules)) {
    fs.mkdirSync(path.join(root, "modules", id), { recursive: true });
    if (manifest !== null) fs.writeFileSync(path.join(root, "modules", id, "module.json"), typeof manifest === "string" ? manifest : JSON.stringify(manifest));
  }
  return root;
}
const base = (id, extra = {}) => ({ id, title: "T", summary: "S", phase: "day-1", order: 10, ...extra });

test("loadKit rejects malformed kits", () => {
  const bad = {
    "unknown key": { a: base("a", { surprise: 1 }) },
    "id is not the directory": { a: base("b") },
    "bad phase": { a: base("a", { phase: "someday" }) },
    "missing module.json": { a: null },
    "invalid JSON": { a: "{" },
    "unknown requirement": { a: base("a", { requires: ["ghost"] }) },
    "cycle": { a: base("a", { requires: ["b"] }), b: base("b", { requires: ["a"] }) },
    "placeholder without pattern": { a: base("a", { placeholders: { X: { prompt: "p", default: "d" } } }) },
    "placeholder key with double underscore": { a: base("a", { placeholders: { A__B: { prompt: "p", default: "d", pattern: "d" } } }) },
    "seed outside the project": { a: base("a", { seed: ["../x"] }) },
    "append outside the project": { a: base("a", { append: [{ file: "../x", from: "append/x", marker: "m" }] }) },
  };
  for (const [why, modules] of Object.entries(bad)) assert.throws(() => loadKit(fixtureKit(modules)), undefined, why);
  assert.equal(loadKit(fixtureKit({ a: base("a"), b: base("b", { requires: ["a"] }) })).modules.size, 2);
});

test("resolveSelection adds requirements and required modules, in install order", () => {
  const k = loadKit(fixtureKit({ core: base("core", { required: true, order: 10 }), a: base("a", { order: 30, requires: ["core"] }), b: base("b", { order: 20, requires: ["a"] }), c: base("c", { order: 5 }) }));
  assert.deepEqual(resolveSelection(k, []), ["core"]);
  assert.deepEqual(resolveSelection(k, ["b"]), ["core", "b", "a"]);
  assert.deepEqual(resolveSelection(k, ["c", "b", "a"]), ["c", "core", "b", "a"]);
  assert.throws(() => resolveSelection(k, ["nope"]), /unknown module "nope"/);
});

// ── static rules on the real modules ────────────────────────────────────────
test("the kit has a required core and every module declares a known phase", () => {
  assert.equal(kit.modules.get("core")?.required, true);
  for (const m of listModules(kit)) { assert.ok(PHASES.includes(m.phase), m.id); assert.ok((m.requires ?? []).includes("core") || m.id === "core", `${m.id} lists core in "requires"`); }
});

const textFilesOf = (mod) => [
  ...walk(path.join(mod.dir, "files")).map((rel) => path.join(mod.dir, "files", rel)),
  ...walk(path.join(mod.dir, "fragments")).map((rel) => path.join(mod.dir, "fragments", rel)),
  ...(mod.append ?? []).map((a) => path.join(mod.dir, a.from)),
];

test("every placeholder a module uses is declared by it or by a module it requires", () => {
  for (const [id, mod] of kit.modules) {
    const declared = new Set(closureOf(id).flatMap((dep) => Object.keys(kit.modules.get(dep).placeholders ?? {})));
    for (const file of textFilesOf(mod)) for (const key of tokensIn(read(file))) assert.ok(declared.has(key), `${path.relative(kit.root, file)} uses __HARNESS_${key}__, which ${id} and its requirements do not declare`);
  }
});

// A kit-owned file the project has to edit is a conflict at every update. What the project decides is a
// placeholder value (recorded, rendered again by `update --set`) or lives in a seed. A convention page may
// name the marker in its prose.
test("no kit-owned file asks the project to edit it: TODO(harness) markers are in seeds only", () => {
  for (const [id, mod] of kit.modules) for (const rel of walk(path.join(mod.dir, "files"))) {
    const seed = (mod.seed ?? []).some((g) => g === rel || (g.endsWith("/**") && rel.startsWith(g.slice(0, -2))));
    if (!seed && !rel.endsWith(".md")) assert.doesNotMatch(read(mod.dir, `files/${rel}`), /TODO\(harness\)/, `${id}: ${rel} is kit-owned and carries a TODO(harness)`);
  }
});

test("a placeholder declared by several modules has one spec", () => {
  const seen = new Map();
  for (const [id, mod] of kit.modules) for (const [key, spec] of Object.entries(mod.placeholders ?? {})) {
    const json = JSON.stringify(spec);
    if (seen.has(key)) assert.equal(json, seen.get(key).json, `${key} is declared differently by ${seen.get(key).id} and ${id}`);
    else seen.set(key, { json, id });
  }
});

test("no two modules ship the same path, and none ships the manifest", () => {
  const owner = new Map();
  for (const [id, mod] of kit.modules) for (const rel of walk(path.join(mod.dir, "files"))) {
    assert.notEqual(rel, ".claude/harness.json", id);
    assert.ok(!owner.has(rel), `${rel} is shipped by ${owner.get(rel)} and ${id}`);
    owner.set(rel, id);
  }
});

const isSeed = (mod, rel) => (mod.seed ?? []).some((g) => g === rel || (g.endsWith("/**") && rel.startsWith(g.slice(0, -2))));

test("every fragment targets a seed file and a slot that will be there", () => {
  const shipped = new Map(); // rel -> module id
  for (const [id, mod] of kit.modules) for (const rel of walk(path.join(mod.dir, "files"))) shipped.set(rel, id);
  // slots provided by a fragment itself (a table inside an inserted section), by target file
  const nested = new Map();
  for (const [id, mod] of kit.modules) for (const rel of walk(path.join(mod.dir, "fragments"))) for (const s of slotsIn(read(mod.dir, "fragments", rel))) nested.set(`${path.posix.dirname(rel)}#${s}`, id);
  for (const [id, mod] of kit.modules) for (const rel of walk(path.join(mod.dir, "fragments"))) {
    assert.match(rel, /\/[a-z0-9-]+\.frag$/, `${id}/fragments/${rel}: <target path>/<slot>.frag`);
    const target = path.posix.dirname(rel), slot = path.posix.basename(rel, ".frag");
    const owner = shipped.get(target);
    assert.ok(owner, `${id}: fragment targets ${target}, which no module ships`);
    assert.ok(isSeed(kit.modules.get(owner), target), `${id}: fragment targets ${target}, which ${owner} does not declare as a seed`);
    const inFile = slotsIn(read(kit.modules.get(owner).dir, "files", target)).includes(slot);
    const provider = nested.get(`${target}#${slot}`);
    assert.ok(inFile || provider, `${id}: no slot "${slot}" in ${target}`);
    if (!inFile) assert.ok(closureOf(id).includes(provider), `${id}: slot "${slot}" comes from ${provider}'s fragment, so ${id} must require ${provider}`);
    assert.ok(read(mod.dir, "fragments", rel).trim(), `${id}/fragments/${rel} is empty`);
  }
});

// "At most five lines" limits nothing when a bullet is one long line: the cap is in bytes.
const BULLET_MAX = 400;

test("CLAUDE.md bullets stay short and point to a page the module installs", () => {
  for (const line of read(kit.modules.get("core").dir, "files/CLAUDE.md").split("\n").filter((l) => /^- \*\*[^*]+\*\*: /.test(l)))
    assert.ok(Buffer.byteLength(line) <= BULLET_MAX, `core: the seed's bullet "${line.slice(0, 40)}…" is ${Buffer.byteLength(line)} bytes, keep it under ${BULLET_MAX}`);
  for (const [id, mod] of kit.modules) {
    const file = path.join(mod.dir, "fragments/CLAUDE.md/conventions.frag");
    if (!fs.existsSync(file)) continue;
    const available = new Set(closureOf(id).flatMap((dep) => walk(path.join(kit.modules.get(dep).dir, "files"))));
    for (const line of read(file).trim().split("\n")) {
      assert.match(line, /^- \*\*[^*]+\*\*: /, `${id}: a conventions bullet starts with "- **Name**: "`);
      assert.ok(Buffer.byteLength(line) <= BULLET_MAX, `${id}: conventions bullet is ${Buffer.byteLength(line)} bytes, keep it under ${BULLET_MAX} (CLAUDE.md has a budget) — or scope the rule to its files in files/.claude/rules/`);
      const pointers = [...line.matchAll(/`(docs\/[A-Za-z0-9_./-]+\.md)`/g)].map((m) => m[1]);
      assert.ok(/→ `docs\//.test(line) && pointers.length, `${id}: a conventions bullet ends with → \`docs/conventions/<slug>.md\``);
      for (const p of pointers) assert.ok(available.has(p), `${id}: bullet points to ${p}, which the module does not install`);
    }
  }
});

// A rule in .claude/rules/ without a `paths:` list is loaded at launch like CLAUDE.md: shipped by a module it would
// spend the project's budget from outside the file the budget is written in. So a module's rule is always scoped,
// kit-owned (so that `update` refreshes it), short, and points to the page that holds the detail.
test("a rule a module ships under .claude/rules/ is path-scoped, short and points to a page the module installs", () => {
  let seen = 0;
  for (const [id, mod] of kit.modules) {
    const available = new Set(closureOf(id).flatMap((dep) => walk(path.join(kit.modules.get(dep).dir, "files"))));
    for (const rel of walk(path.join(mod.dir, "files")).filter((r) => r.startsWith(".claude/rules/"))) {
      seen++;
      assert.match(rel, /^\.claude\/rules\/[a-z0-9-]+\.md$/, `${id}: ${rel} — one flat file per topic, <slug>.md`);
      assert.ok(!isSeed(mod, rel), `${id}: ${rel} is machinery, not a seed`);
      const text = read(mod.dir, "files", rel);
      const fm = /^---\npaths:\n((?:  - "[^"\n]+"\n)+)---\n\n([\s\S]+)$/.exec(text);
      assert.ok(fm, `${id}: ${rel} starts with a frontmatter holding only \`paths:\` and a list of double-quoted globs, then a blank line`);
      for (const g of fm[1].trim().split("\n").map((l) => l.slice(5, -1))) {
        assert.doesNotMatch(g, /^(\*\*(\/\*)?|\*|\*\*\/\*\.md)$/, `${id}: ${rel} — the glob "${g}" matches everything: that is a bullet of CLAUDE.md, with its budget`);
        assert.doesNotMatch(g, /^\/|\.\.|\\/, `${id}: ${rel} — "${g}" is relative to the project root, with forward slashes`);
      }
      assert.ok(Buffer.byteLength(fm[2]) <= 1200, `${id}: ${rel} carries ${Buffer.byteLength(fm[2])} bytes of rule, keep it under 1200 — the detail goes to the convention page`);
      const pointers = [...fm[2].matchAll(/`(docs\/[A-Za-z0-9_./-]+\.md)`/g)].map((m) => m[1]);
      assert.ok(/→ `docs\/[^`]+`\n$/.test(fm[2]) && pointers.length, `${id}: ${rel} ends with → \`docs/conventions/<slug>.md\``);
      for (const p of pointers) assert.ok(available.has(p), `${id}: ${rel} points to ${p}, which the module does not install`);
    }
  }
  assert.ok(seen > 0, "no module ships a rule any more: drop this test or the contract section");
});

// CLAUDE.md § Before pushing grades the review by tier: a pass that does not say which tiers it belongs to
// would run on every diff, which is the cost the tiers exist to avoid.
test("a review pass added to \"Before pushing\" names its tiers, and the slot keeps the list whole", () => {
  for (const [id, mod] of kit.modules) {
    const file = path.join(mod.dir, "fragments/CLAUDE.md/before-pushing.frag");
    if (!fs.existsSync(file)) continue;
    for (const line of read(file).trim().split("\n")) assert.match(line, /^1\. \*\*[^*]+\*\* \((tier [23]|tiers 2, 3)[,)]/, `${id}: a before-pushing row is "1. **<pass>** (tier 3)" or "(tiers 2, 3)"`);
  }
  // A comment at the left margin would end the numbered list; indented to the items' text it stays inside it.
  const lines = read(kit.modules.get("core").dir, "files/CLAUDE.md").split("\n");
  const at = lines.findIndex((l) => l.includes("harness:rows before-pushing"));
  assert.match(lines[at], /^ {3}<!-- harness:rows before-pushing -->$/);
  assert.match(lines[at + 1], /^1\. /, "the built-in passes follow the marker directly");
});

test("guards follow the contract and scripts are executable", () => {
  for (const [id, mod] of kit.modules) for (const rel of walk(path.join(mod.dir, "files"))) {
    const abs = path.join(mod.dir, "files", rel);
    const executable = (fs.statSync(abs).mode & 0o111) !== 0;
    if (/^scripts\/guards\.d\/[0-9][0-9]-[a-z0-9-]+\.sh$/.test(rel)) {
      const src = read(abs);
      assert.ok(executable, `${id}: ${rel} must be executable`);
      assert.match(src, /^#!\/usr\/bin\/env bash\n/, `${id}: ${rel} starts with #!/usr/bin/env bash`);
      assert.match(src, /^\. "\$\(dirname "\$0"\)\/_lib\.sh"$/m, `${id}: ${rel} sources _lib.sh`);
      assert.match(src, /^finish$/m, `${id}: ${rel} ends with finish`);
    } else if (rel.startsWith("scripts/guards.d/") && rel !== "scripts/guards.d/_lib.sh") assert.fail(`${id}: ${rel} — guards are named NN-name.sh`);
    if (rel.startsWith(".githooks/") || /^scripts\/[^/]+\.sh$/.test(rel) || /^#!/.test(read(abs).slice(0, 2))) assert.ok(executable, `${id}: ${rel} must be executable`);
  }
});

test("guard numbers are unique across modules", () => {
  const seen = new Map();
  for (const [id, mod] of kit.modules) for (const rel of walk(path.join(mod.dir, "files"))) {
    const n = /^scripts\/guards\.d\/([0-9][0-9])-/.exec(rel)?.[1];
    if (!n) continue;
    assert.ok(!seen.has(n) || seen.get(n) === id, `guard number ${n} is used by ${seen.get(n)} and ${id}`);
    seen.set(n, id);
  }
});

// The documentation set is skipped by CI and merged at once by auto-merge: written in four places, it must be
// one set. And what the CI skeleton takes back after skipping it must be held by the merge gate — a path
// re-included but not held would be merged, as documentation, while the CI run it started is in flight.
test("the docs paths agree across the shipped workflows, and CI re-includes only what the merge gate holds", () => {
  const list = (text, re) => { const m = re.exec(text); assert.ok(m, `${re} not found`); return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]); };
  const ci = read(kit.modules.get("ci-workflow").dir, "files/.github/workflows/ci.yml");
  const security = read(kit.modules.get("ci-security").dir, "files/.github/workflows/security.yml");
  const autoMerge = read(kit.modules.get("auto-merge").dir, "files/.github/workflows/auto-merge.yml");
  const docs = ["docs/**", "**.md", "LICENSE", ".gitignore"];
  assert.deepEqual(list(ci, /\n  push:\n(?:.*\n)*?    paths-ignore: \[(.*)\]\n/), docs, "ci.yml, push");
  const pr = list(ci, /\n  pull_request:\n(?:    .*\n)*?    paths:\n((?:      - .*\n)+)/);
  assert.equal(pr[0], "**", "ci.yml, pull_request: a paths list needs a positive pattern first");
  const lastExclusion = pr.findLastIndex((p) => p.startsWith("!"));
  assert.deepEqual(pr.slice(1, lastExclusion + 1), docs.map((p) => `!${p}`), "ci.yml, pull_request: the exclusions, in one run");
  assert.deepEqual(list(security, /\n  push:\n(?:.*\n)*?    paths:\n((?:      - .*\n)+)/), docs, "security.yml, push");
  assert.deepEqual(list(autoMerge, /\n  pull_request:\n(?:.*\n)*?    paths:\n((?:      - .*\n)+)/), docs, "auto-merge.yml, pull_request");
  const review = read(kit.modules.get("claude-review").dir, "files/.github/workflows/claude-review.yml");
  assert.match(review, /\n  workflow_run: # zizmor: ignore\[dangerous-triggers\]\n    workflows: \["__HARNESS_CI_WORKFLOW__"\]\n    types: \[completed\]\n/, "claude-review.yml follows CI, so it reviews the pull requests CI runs on");
  assert.doesNotMatch(review, /\n  pull_request(_target)?:/, "claude-review.yml is never started by a pull request");
  assert.ok(autoMerge.includes("grep -E -v -c '(\\.md$|^docs/|^LICENSE$|^\\.gitignore$)'"), "auto-merge.yml, NON_DOCS");
  const gate = new RegExp(/^  CLAUDE_GATE_RE: '(.*)'$/m.exec(autoMerge)[1], "i");
  const back = pr.slice(lastExclusion + 1);
  assert.deepEqual(back, [".claude/**", "**/.claude/**", "CLAUDE.md", "**/CLAUDE.md"], "ci.yml, pull_request: the instruction files come back after the exclusions");
  for (const p of back) assert.match(p.replaceAll("**/", "sub/").replaceAll("**", "agents/x.md"), gate, `${p} is re-included by CI, so the merge gate must hold it`);
});

// What the kit ships to be run or read — its scripts and what they read, hooks, instruction files, scanner configs —
// decides what the gate, CI and every session do. A pull request that changes one is judged by a CI that runs or
// reads the changed file, so the unattended merge holds it (CLAUDE_GATE_RE) and a rework never writes it
// (REWORK_HOLD_RE), whichever module ships it — the next one too. The patterns run as the workflows run them,
// through grep -i -E. A file left out on purpose is named below with its reason.
const NOT_HELD_BY_MERGE_GATE = new Map([
  [".github/workflows/ci.yml", "a workflow that calls the gate: auto-merge-policy.md § Residual risks"],
  [".github/workflows/security.yml", "a workflow that calls the gate: auto-merge-policy.md § Residual risks"],
  [".github/workflows/weekly-digest.yml", "a workflow outside the kit's list: auto-merge-policy.md § Residual risks"],
  [".github/workflows/ready-on-green.yml", "a workflow outside the kit's list, and never installed with auto-merge"],
  [".github/dependabot.yml", "a file AM-5 checks, not one that configures a check"],
]);
const NOT_HELD_BY_EITHER = new Map([
  [".worktreeinclude", "the ignored files Claude Code copies into a new worktree on the same machine: it runs nothing"],
]);
const isPage = (rel) => /^docs\/(adr|runbook)\//.test(rel); // read, never executed: the docs path of auto-merge-policy.md

test("the merge gate and the rework hold every file the kit ships to be run or read", () => {
  const pattern = (mod, file, name) => new RegExp(`^  ${name}: '(.*)'$`, "m").exec(read(kit.modules.get(mod).dir, "files", file))?.[1];
  const patterns = {
    CLAUDE_GATE_RE: pattern("auto-merge", ".github/workflows/auto-merge.yml", "CLAUDE_GATE_RE"),
    REWORK_HOLD_RE: pattern("claude-rework", ".github/workflows/claude-rework.yml", "REWORK_HOLD_RE"),
  };
  // grep -v lists the paths a pattern does not match, as the workflows' grep -i -E would read them.
  const unheld = (re, paths) => {
    const r = spawnSync("grep", ["-i", "-E", "-v", "-e", re], { input: `${paths.join("\n")}\n`, encoding: "utf8" });
    assert.ok(r.status === 0 || r.status === 1, `grep failed on the pattern: ${r.stderr}`);
    return r.stdout.split("\n").filter(Boolean);
  };
  const shipped = [...kit.modules.values()].flatMap((mod) => walk(path.join(mod.dir, "files")).map((rel) => ({ id: mod.id, rel })));
  assert.ok(shipped.length > 60, "the scan found the kit's files");
  const owner = new Map(shipped.map(({ id, rel }) => [rel, id]));
  for (const [name, re] of Object.entries(patterns)) {
    assert.ok(re, `${name} is defined`);
    const excused = name === "CLAUDE_GATE_RE" ? new Map([...NOT_HELD_BY_MERGE_GATE, ...NOT_HELD_BY_EITHER]) : NOT_HELD_BY_EITHER;
    const mustHold = shipped.map(({ rel }) => rel).filter((rel) => !isPage(rel) && !excused.has(rel));
    assert.deepEqual(unheld(re, mustHold).map((rel) => `${owner.get(rel)}: ${rel}`), [], `${name} must hold these: add them to it (CLAUDE_GATE_RE in auto-merge.yml with its AM-1 rows and DEFAULT_GATE_RE in weekly-digest.mjs; REWORK_HOLD_RE in claude-rework.yml with REWORK_DIGEST), or name them here with the reason`);
    for (const rel of excused.keys()) assert.ok(owner.has(rel), `${rel} is excused from ${name} but no module ships it any more`);
  }
  // AM-1 runs the kit's pattern on its own table in every project: each script the kit ships is a row there,
  // and every path that table holds is one a rework never writes either.
  const guard = read(kit.modules.get("auto-merge").dir, "files/scripts/guards.d/40-auto-merge.sh");
  const holdRows = /# Must be gated:[^\n]*\n(?:\s*#[^\n]*\n)*\s*for p in ([\s\S]*?); do/.exec(guard)?.[1].split(/[\s\\]+/).filter(Boolean);
  assert.ok(holdRows?.length > 30, "AM-1's table of held paths was found");
  const scripts = shipped.map(({ rel }) => rel).filter((rel) => /^scripts\/[^/]+$/.test(rel));
  assert.deepEqual(scripts.filter((rel) => !holdRows.includes(rel)), [], "each script the kit ships has a held row in AM-1's table (40-auto-merge.sh)");
  assert.deepEqual(unheld(patterns.REWORK_HOLD_RE, holdRows), [], "REWORK_HOLD_RE holds every path AM-1 holds");
});

// gitleaks reads a .gitleaks.json before .gitleaks.toml when it picks its own config: a commit that adds one with an
// allow-all list would silence the scan judging it. Every call the kit ships names the seed.
test("every gitleaks scan the kit ships names .gitleaks.toml as its config", () => {
  let seen = 0;
  for (const mod of kit.modules.values()) for (const rel of walk(path.join(mod.dir, "files")).filter((r) => !r.endsWith(".md"))) {
    for (const line of read(mod.dir, "files", rel).split("\n").filter((l) => /\bgitleaks"? (git|dir|detect|protect)\b/.test(l) && !/^\s*#/.test(l))) {
      seen++;
      assert.match(line, / --config \.gitleaks\.toml /, `${mod.id}: ${rel} runs gitleaks without --config .gitleaks.toml:\n${line.trim()}`);
    }
  }
  assert.ok(seen >= 2, "the scan found the security workflow's and the pre-commit hook's calls");
});

// Without auto-merge.yml the digest falls back to its own copy of the kit's gate pattern: one list, two files.
test("the weekly digest's built-in gate pattern is the one auto-merge ships", () => {
  const shipped = /^  CLAUDE_GATE_RE: '(.*)'$/m.exec(read(kit.modules.get("auto-merge").dir, "files/.github/workflows/auto-merge.yml"))[1];
  const digest = read(kit.modules.get("weekly-digest").dir, "files/scripts/weekly-digest.mjs");
  const builtin = /^export const DEFAULT_GATE_RE = '(.*)';$/m.exec(digest)[1].replaceAll("\\\\", "\\");
  assert.equal(builtin, shipped);
});

// An older Node takes `node --test <directory>` for a module to run and fails; a newer one searches the
// directory. Written on the newer, it breaks on a runner: name the files, everywhere.
test("node --test is always given test files, never a directory", () => {
  const kitFiles = ["README.md", "CLAUDE.md", "package.json", "docs/module-authoring.md", ...walk(path.join(kit.root, ".github")).map((f) => `.github/${f}`), ...walk(path.join(kit.root, "test")).map((f) => `test/${f}`), ...walk(path.join(kit.root, "skills")).map((f) => `skills/${f}`)];
  const files = [...kitFiles.map((f) => path.join(kit.root, f)), ...[...kit.modules.values()].flatMap(textFilesOf)];
  let seen = 0;
  for (const file of files) {
    if (file.endsWith("agent-bash-guard.test.mjs")) continue; // its table lists the directory forms on purpose, as commands to block
    if (file.endsWith(path.join("test", "engine.test.mjs"))) continue; // this explanation
    for (const m of read(file).matchAll(/node --test((?: +[^\s`"'|&;)#]+)+)/g)) {
      const first = m[1].trim().split(/ +/).find((a) => !a.startsWith("-"));
      assert.match(first ?? "", /\.(mjs|cjs|js)$/, `${path.relative(kit.root, file)}: "node --test ${first}" does not name a test file`);
      seen++;
    }
  }
  assert.ok(seen >= 5, "the scan found the commands it is meant to check");
});

test("every post-install line and summary is one line of plain text", () => {
  for (const m of listModules(kit)) {
    assert.ok(!m.summary.includes("\n") && m.summary.length <= 320, `${m.id}: summary`);
    for (const line of m.postInstall ?? []) assert.ok(line.trim() && !line.includes("\n"), `${m.id}: postInstall`);
  }
});

// ── the kit's releases (bin/release.mjs) ────────────────────────────────────
// A pull request adds changes/<slug>.md; a release turns the fragments into the next version and its entry.
test("every changelog fragment waiting in changes/ is well formed, and together they make the next entry", () => {
  let fragments;
  assert.doesNotThrow(() => { fragments = readFragments(kit.root); }, "changes/<slug>.md: `bump: patch|minor|major`, a blank line, the lines of the entry, then a paragraph that starts with `By hand:` (the top of CHANGELOG.md)");
  for (const f of fragments) {
    assert.ok(LEVELS.includes(f.level), `${f.file}: level`);
    assert.match(f.byHand, /^By hand: \S/, `${f.file}: its "By hand" part`);
  }
  if (!fragments.length) return;
  const version = nextVersion(kit.version, highestLevel(fragments));
  const changelog = insertEntry(read(kit.root, "CHANGELOG.md"), composeEntry(version, fragments), kit.version);
  assert.equal(parseEntries(changelog)[0].version, version, "the release can put them on top of CHANGELOG.md today");
});

test("parseFragment reads a level, the lines of the entry and the By hand part", () => {
  assert.deepEqual(parseFragment("bump: minor\n\nIntro.\n\n- One.\n- Two.\n\nBy hand: nothing. To take the module: add it.\n"),
    { level: "minor", body: "Intro.\n\n- One.\n- Two.", byHand: "By hand: nothing. To take the module: add it.", nothing: true, step: "", remark: "To take the module: add it." });
  const step = parseFragment("bump: patch\r\n\r\n- One.\r\n\r\nBy hand: delete the line\r\nfrom the skeleton.\r\n\r\nThen check it.\r\n");
  assert.deepEqual([step.level, step.nothing, step.step], ["patch", false, "delete the line\nfrom the skeleton.\n\nThen check it."], "CRLF reads as LF, and the part runs to the end of the file");
  assert.equal(parseFragment("bump: major\n\n```bash\n# a comment, not a heading\n```\n\nBy hand: nothing.\n").level, "major", "a # line inside a code fence is code");
});

test("parseFragment refuses what a release could not turn into an entry", () => {
  const bad = {
    "": /first line/,
    "bump: huge\n\n- x\n\nBy hand: nothing.\n": /first line/,
    "Bump: patch\n\n- x\n\nBy hand: nothing.\n": /first line/,
    "- x\n\nbump: patch\n\nBy hand: nothing.\n": /first line/,
    "bump: patch\n- x\n\nBy hand: nothing.\n": /a blank line follows the bump line/,
    "bump: patch\n\n- x\n": /last paragraph starts with "By hand:"/,
    "bump: patch\n\n- x\n\nBy hand, for an installed project: do it.\n": /starts with "By hand: " and a sentence on the same line/,
    "bump: patch\n\n- x\n\nBy hand:\n\n- do it.\n": /starts with "By hand: " and a sentence on the same line/,
    "bump: patch\n\n- x\nBy hand: nothing.\n": /a blank line comes before/,
    "bump: patch\n\nBy hand: nothing.\n": /the lines of the entry go between/,
    "bump: patch\n\n- x\n\nBy hand: nothing.\n\nBy hand: again.\n": /lines 5, 7 start with "By hand"/,
    "bump: patch\n\nBy hand is how it is done.\n\nBy hand: nothing.\n": /lines 3, 5 start with "By hand"/,
    "bump: patch\n\n## 1.2.3\n\n- x\n\nBy hand: nothing.\n": /line 3: no heading/,
    "bump: patch\n\n# Notes\n\n- x\n\nBy hand: nothing.\n": /line 3: no heading/,
    "bump: patch\n\n```\n## 1.2.3\n```\n\nBy hand: nothing.\n": /line 4: no heading/, // CHANGELOG.md is split there, fence or not
  };
  for (const [text, why] of Object.entries(bad)) assert.throws(() => parseFragment(text), why, JSON.stringify(text));
});

test("readFragments: every file of changes/ is a fragment, in the order of the entry", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-changes-"));
  assert.deepEqual(readFragments(root), [], "no changes/ directory: nothing waits");
  const put = (name, text) => { fs.mkdirSync(path.join(root, "changes"), { recursive: true }); fs.writeFileSync(path.join(root, "changes", name), text); };
  const fragment = (level) => `bump: ${level}\n\n- A change.\n\nBy hand: nothing.\n`;
  put("c-fix.md", fragment("patch")); put("a-fix.md", fragment("patch")); put("b-module.md", fragment("major")); put(".DS_Store", "");
  assert.deepEqual(readFragments(root).map((f) => [f.file, f.level]), [["changes/b-module.md", "major"], ["changes/a-fix.md", "patch"], ["changes/c-fix.md", "patch"]], "the highest level first, then by name");
  put("Notes.txt", "x"); put("d-bad.md", "bump: later\n"); fs.mkdirSync(path.join(root, "changes", "sub"));
  assert.throws(() => readFragments(root), (e) => ["changes/Notes.txt: not a fragment", "changes/d-bad.md: the first line", "changes/sub: not a fragment"].every((s) => e.message.includes(s)), "every problem, one line each");
});

test("the next version is the highest level among the fragments", () => {
  assert.deepEqual(LEVELS.map((level) => nextVersion("0.8.3", level)), ["0.8.4", "0.9.0", "1.0.0"]);
  assert.equal(nextVersion("1.9.9", "minor"), "1.10.0");
  assert.throws(() => nextVersion("1.0", "patch"));
  assert.throws(() => nextVersion("1.0.0", "huge"));
  assert.equal(highestLevel([{ level: "patch" }, { level: "minor" }, { level: "patch" }]), "minor");
  assert.equal(highestLevel([{ level: "major" }, { level: "minor" }]), "major");
  assert.equal(highestLevel([{ level: "patch" }]), "patch");
});

// What `update` shows comes from the entry: the steps read back as steps, and a release with none lists none.
test("composeEntry: the fragments' lines, then one By hand part that lib/changelog.mjs reads back", () => {
  const f = (level, body, byHand) => parseFragment(`bump: ${level}\n\n${body}\n\n${byHand}\n`);
  const module = f("minor", "- New module.", "By hand: nothing. To take the module: `add . --modules x`.");
  const fix = f("patch", "- A fix.\n- Another.", "By hand: nothing.");
  const intro = f("patch", "Installer only.\n\n- A change.", "By hand: nothing.");
  const remark = f("patch", "- A third.", "By hand: nothing. A remark.");
  const skeleton = f("patch", "- Skeleton change.", "By hand: add the bullet\nto the skeleton.");
  const rename = f("patch", "- A rename.", "By hand: rename the file.");
  const cases = [
    [[fix], "- A fix.\n- Another.\n\nBy hand: nothing.", ""],
    [[module, fix], "- New module.\n- A fix.\n- Another.\n\nBy hand: nothing. To take the module: `add . --modules x`.", ""],
    [[fix, intro], "- A fix.\n- Another.\n\nInstaller only.\n\n- A change.\n\nBy hand: nothing.", ""],
    [[module, remark], "- New module.\n- A third.\n\nBy hand: nothing. To take the module: `add . --modules x`.\n\nA remark.", ""],
    [[module, skeleton], "- New module.\n- Skeleton change.\n\nBy hand: add the bullet\nto the skeleton.\n\nTo take the module: `add . --modules x`.", "By hand: add the bullet\nto the skeleton.\n\nTo take the module: `add . --modules x`."],
    [[skeleton, rename], "- Skeleton change.\n- A rename.\n\nBy hand:\n\n- add the bullet\n  to the skeleton.\n- rename the file.", "By hand:\n\n- add the bullet\n  to the skeleton.\n- rename the file."],
  ];
  for (const [fragments, text, byHand] of cases) {
    const entry = composeEntry("1.0.0", fragments);
    assert.equal(entry, `## 1.0.0\n\n${text}\n`);
    assert.deepEqual(parseEntries(`# Changelog\n\n${entry}`), [{ version: "1.0.0", byHand }], `read back as one entry:\n${entry}`);
    assert.equal((entry.match(/^By hand\b/gm) ?? []).length, 1, "one line starts with By hand");
  }
  assert.throws(() => composeEntry("1.0.0", []));
});

test("insertEntry puts the entry on top, under the header, and refuses a changelog out of step", () => {
  const log = "# Changelog\n\nHeader.\n\n## 0.8.0\n\n- Old.\n\nBy hand: nothing.\n";
  const entry = "## 0.9.0\n\n- New.\n\nBy hand: nothing.\n";
  assert.equal(insertEntry(log, entry, "0.8.0"), "# Changelog\n\nHeader.\n\n## 0.9.0\n\n- New.\n\nBy hand: nothing.\n\n## 0.8.0\n\n- Old.\n\nBy hand: nothing.\n");
  assert.throws(() => insertEntry(log, entry, "0.7.0"), /starts with 0\.8\.0 and kit\.json says 0\.7\.0/);
  assert.throws(() => insertEntry("# Changelog\n", entry, "0.8.0"), /no entry yet/);
  assert.throws(() => insertEntry(log, "## 0.9.0\n\n- New.\n", "0.8.0"), /would not read back/, "an entry without its By hand part");
  assert.throws(() => insertEntry(log, "## 0.9.0\n\nBy hand: nothing.\n\nBy hand: again.\n", "0.8.0"), /would not read back/);
});

test("setVersion changes the version alone and keeps the file's layout", () => {
  const pkg = '{\n  "name": "x",\n  "version": "0.8.0",\n  "bin": { "harness": "bin/harness.mjs" }\n}\n';
  assert.equal(setVersion(pkg, "0.8.0", "0.9.0", "package.json"), pkg.replace("0.8.0", "0.9.0"));
  assert.throws(() => setVersion(pkg, "0.7.0", "0.9.0", "package.json"), /package\.json says version 0\.8\.0/);
  assert.throws(() => setVersion('{ "engines": { "version": "0.8.0" }, "version": "0.8.0" }', "0.8.0", "0.9.0", "x.json"), /could not be changed alone/, "the first match is not the top-level key");
});
