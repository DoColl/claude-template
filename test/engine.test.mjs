// node --test test/*.test.mjs — the installer's pure parts and the static rules every module must satisfy
// (docs/module-authoring.md). The end-to-end installs are in install.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadKit, resolveSelection, listModules, PHASES } from "../lib/kit.mjs";
import { walk } from "../lib/install.mjs";
import { render, tokensIn, insertAtSlot, slotsIn, appendBlock } from "../lib/render.mjs";

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
