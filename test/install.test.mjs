// node --test test/ — end-to-end: install modules into a scratch project, run its gate, add, update, conflict.
// Needs git and bash. The gate runs offline, and with CI unset so a guard whose tool is missing skips.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadKit, listModules, KIT_ROOT } from "../lib/kit.mjs";
import { buildPlan, applyPlan, summarize, readManifest, drift, walk, MANIFEST } from "../lib/install.mjs";

const kit = loadKit();
const CLI = path.join(KIT_ROOT, "bin/harness.mjs");
const ALL = listModules(kit).map((m) => m.id);
const tmp = (prefix = "harness-e2e-") => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const run = (cwd, cmd, args, opts = {}) => spawnSync(cmd, args, { cwd, encoding: "utf8", ...opts });
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", input: "" });
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), "utf8");
const write = (dir, rel, text, mode) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); if (mode) fs.chmodSync(path.join(dir, rel), mode); };
const install = (target, moduleIds, extra = {}) => { const plan = buildPlan({ kit, target, moduleIds, given: { PROJECT_NAME: "demo-app" }, ...extra }); applyPlan(plan); return plan; };

// The gate reads tracked files (AG-2, the TODO count): put the tree in an index first.
function gate(dir, ...args) {
  assert.equal(run(dir, "git", ["init", "-q", "-b", "main"]).status, 0, "git init");
  assert.equal(run(dir, "git", ["add", "-A"]).status, 0, "git add");
  return run(dir, "bash", ["scripts/security-checks.sh", ...(args.length ? args : ["--offline"])], { env: { ...process.env, CI: "" } });
}
const output = (r) => `${r.stdout}\n${r.stderr}`;

for (const id of ALL) {
  test(`${id}: installs with what it requires, leaves no placeholder, passes its own gate`, () => {
    const dir = tmp();
    const plan = install(dir, [id]);
    assert.deepEqual(summarize(plan).fragmentsMissingSlot, []);
    for (const rel of walk(dir)) if (!rel.startsWith(".git/")) assert.doesNotMatch(read(dir, rel), /__HARNESS_[A-Z0-9_]+__/, `${rel} still has a placeholder`);
    const r = gate(dir);
    assert.equal(r.status, 0, `the gate fails in a project with only ${plan.selected.join(", ")}:\n${output(r)}`);
  });
}

test("all modules together: one gate, every fragment placed, CLAUDE.md well under its budget, idempotent", () => {
  const dir = tmp();
  const plan = install(dir, ALL);
  assert.deepEqual(plan.fragments.filter((f) => f.status !== "insert").map((f) => `${f.key}: ${f.status}`), [], "every fragment finds its slot when everything is installed");
  const r = gate(dir);
  assert.equal(r.status, 0, output(r));
  const budget = Number(/harness:budget (\d+)/.exec(read(dir, "CLAUDE.md"))[1]);
  const size = fs.statSync(path.join(dir, "CLAUDE.md")).size;
  assert.ok(size <= budget * 0.6, `CLAUDE.md is ${size} bytes with every module: leave the project at least 40% of its ${budget}-byte budget`);
  const again = summarize(buildPlan({ kit, target: dir }));
  assert.deepEqual([again.created, again.updated, again.appended, again.fragmentsInserted, again.conflicts, again.outdated], [[], [], [], [], [], []], "a second run writes nothing");
  assert.deepEqual(drift(dir, readManifest(dir)), { modified: [], missing: [] });
  assert.deepEqual(readManifest(dir).modules, plan.selected);
});

test("core alone says nothing about what is not installed", () => {
  const dir = tmp();
  install(dir, []);
  const claude = read(dir, "CLAUDE.md");
  assert.doesNotMatch(claude, /## Delegation|agent-bash-guard|auto-merge|weekly digest/i);
  assert.match(claude, /Guidance for Claude Code in the demo-app repository/);
  assert.ok(!fs.existsSync(path.join(dir, ".claude/agents")));
  assert.match(read(dir, ".gitignore"), /# >>> claude-template\n[\s\S]*!\.claude\/harness\.json[\s\S]*# <<< claude-template\n/);
});

test("a module added later inserts its fragments once", () => {
  if (!kit.modules.has("agents")) return;
  const dir = tmp();
  install(dir, []);
  write(dir, "CLAUDE.md", read(dir, "CLAUDE.md").replace("## Project overview\n", "## Project overview\n\nA demo application.\n"));
  const added = install(dir, ["agents"]);
  assert.ok(summarize(added).fragmentsInserted.includes("agents:CLAUDE.md#delegation"));
  assert.deepEqual(summarize(install(dir, ["agents"])).fragmentsInserted, []);
  const claude = read(dir, "CLAUDE.md");
  assert.equal(claude.split("## Delegation").length - 1, 1, "the section is there exactly once");
  assert.match(claude, /A demo application\./, "what the project wrote is kept");
  assert.equal(gate(dir).status, 0);
});

test("an existing file is never overwritten silently; seeds not even with --force", () => {
  const dir = tmp();
  write(dir, "CLAUDE.md", "# My own instructions\n");
  write(dir, "scripts/security-checks.sh", "#!/bin/sh\necho mine\n");
  write(dir, ".gitignore", "node_modules/\n");
  const first = cli("init", dir, "--modules", "core", "--set", "PROJECT_NAME=demo-app");
  assert.equal(first.status, 2, `conflicts are reported through the exit code:\n${output(first)}`);
  assert.match(first.stdout, /CONFLICTS[\s\S]*scripts\/security-checks\.sh/);
  assert.equal(read(dir, "scripts/security-checks.sh"), "#!/bin/sh\necho mine\n");
  assert.equal(read(dir, "CLAUDE.md"), "# My own instructions\n");
  assert.match(read(dir, ".gitignore"), /^node_modules\/\n\n# >>> claude-template\n/);
  const forced = cli("init", dir, "--force");
  assert.equal(forced.status, 0, output(forced));
  assert.match(read(dir, "scripts/security-checks.sh"), /The local gate/);
  assert.equal(read(dir, "CLAUDE.md"), "# My own instructions\n", "a seed is the project's, --force or not");
  if (kit.modules.has("agents")) {
    const add = cli("add", dir, "--modules", "agents");
    assert.match(add.stdout, /fragments NOT inserted[\s\S]*delegation\.frag → CLAUDE\.md/, "a project CLAUDE.md without slots gets the fragments listed, to paste by hand");
    assert.ok(!readManifest(dir).fragments.includes("agents:CLAUDE.md#delegation"));
  }
});

test("a removed slot leaves the fragment pending until the slot is back", () => {
  if (!kit.modules.has("agents")) return;
  const dir = tmp();
  install(dir, []);
  const slot = "<!-- harness:slot delegation -->\n";
  write(dir, "CLAUDE.md", read(dir, "CLAUDE.md").replace(slot, ""));
  assert.equal(install(dir, ["agents"]).fragments.find((f) => f.key === "agents:CLAUDE.md#delegation").status, "missing-slot");
  write(dir, "CLAUDE.md", read(dir, "CLAUDE.md").replace("## Key conventions\n", `${slot}## Key conventions\n`));
  assert.equal(install(dir, []).fragments.find((f) => f.key === "agents:CLAUDE.md#delegation").status, "insert");
  assert.match(read(dir, "CLAUDE.md"), /## Delegation/);
});

// A copy of the kit that the test can change, to play a kit upgrade.
function kitCopy() {
  const root = tmp("harness-kitcopy-");
  for (const rel of ["kit.json", "modules/core"]) fs.cpSync(path.join(KIT_ROOT, rel), path.join(root, rel), { recursive: true });
  return root;
}

test("update refreshes the kit files left untouched and leaves edited ones alone", () => {
  const root = kitCopy(), dir = tmp();
  applyPlan(buildPlan({ kit: loadKit(root), target: dir, given: { PROJECT_NAME: "demo-app" } }));
  // the project edits two kit files; the kit then changes one of them, plus a third file, and adds a new one
  write(dir, "docs/conventions/local-gate.md", `${read(dir, "docs/conventions/local-gate.md")}\nProject note.\n`);
  write(dir, "docs/conventions/claude-md.md", `${read(dir, "docs/conventions/claude-md.md")}\nProject note.\n`);
  const coreFiles = path.join(root, "modules/core/files");
  write(coreFiles, "docs/conventions/local-gate.md", `${read(coreFiles, "docs/conventions/local-gate.md")}\nKit v2.\n`);
  write(coreFiles, "scripts/guards.d/_lib.sh", `${read(coreFiles, "scripts/guards.d/_lib.sh")}# kit v2\n`);
  write(coreFiles, "docs/conventions/new-page.md", "# New in v2\n");
  write(coreFiles, "CLAUDE.md", `${read(coreFiles, "CLAUDE.md")}\nKit v2 skeleton.\n`);
  fs.writeFileSync(path.join(root, "kit.json"), JSON.stringify({ name: "claude-template", version: "9.9.9" }));
  const v2 = loadKit(root);

  const asInstall = summarize(buildPlan({ kit: v2, target: dir }));
  assert.deepEqual(asInstall.outdated, ["scripts/guards.d/_lib.sh"], "init/add only reports a newer kit file");
  const plan = buildPlan({ kit: v2, target: dir, mode: "update" });
  const s = summarize(plan);
  assert.deepEqual(s.updated, ["scripts/guards.d/_lib.sh"]);
  assert.deepEqual(s.created, ["docs/conventions/new-page.md"]);
  assert.deepEqual(s.conflicts.map((c) => c.file), ["docs/conventions/local-gate.md"], "edited here and changed in the kit: a human decides");
  assert.deepEqual(s.local, ["docs/conventions/claude-md.md"], "edited here, unchanged in the kit: nothing to do");
  assert.deepEqual(s.kept, ["CLAUDE.md"], "a seed never follows the kit");
  applyPlan(plan);
  assert.match(read(dir, "scripts/guards.d/_lib.sh"), /# kit v2\n$/);
  assert.match(read(dir, "docs/conventions/local-gate.md"), /Project note\.\n$/);
  assert.doesNotMatch(read(dir, "CLAUDE.md"), /Kit v2 skeleton/);
  assert.equal(readManifest(dir).kit.version, "9.9.9");
  assert.deepEqual(summarize(buildPlan({ kit: v2, target: dir, mode: "update" })).updated, [], "a second update has nothing left to refresh");
  assert.equal(gate(dir).status, 0);
});

test("the CLI refuses bad input and --dry-run writes nothing", () => {
  const list = cli("list", "--json");
  assert.equal(list.status, 0); assert.deepEqual(JSON.parse(list.stdout).modules.map((m) => m.id), ALL);
  const dir = tmp();
  const noModules = cli("init", dir); assert.equal(noModules.status, 1); assert.match(noModules.stderr, /--modules <ids> or --all/);
  assert.equal(cli("init", dir, "--modules", "nope").status, 1);
  const injected = cli("init", dir, "--modules", "core", "--set", "PROJECT_NAME=$(rm -rf x)"); assert.equal(injected.status, 1); assert.match(injected.stderr, /does not match/);
  assert.equal(cli("init", dir, "--modules", "core", "--set", "DEFAULT_BRANCH=main; rm").status, 1);
  assert.match(cli("init", dir, "--modules", "core", "--set", "NOPE=1").stderr, /unknown placeholder NOPE/);
  assert.equal(cli("status", dir).status, 1);
  assert.equal(cli("add", dir, "--modules", "core").status, 1, "add needs an initialised project");
  assert.equal(cli("frobnicate").status, 1);
  const dry = cli("init", dir, "--all", "--dry-run"); assert.equal(dry.status, 0, output(dry)); assert.match(dry.stdout, /dry run/);
  assert.deepEqual(fs.readdirSync(dir), [], "a dry run leaves the directory empty");
  const real = cli("init", dir, "--modules", "core"); assert.equal(real.status, 0, output(real));
  assert.match(real.stdout, /Next steps[\s\S]*TODO\(harness\) marker/);
  const st = cli("status", dir, "--json"); assert.equal(st.status, 0);
  const status = JSON.parse(st.stdout); assert.deepEqual(status.modules, ["core"]); assert.ok(status.todos.length > 0); assert.deepEqual(status.modified, []);
  assert.equal(readManifest(dir).values.PROJECT_NAME, path.basename(dir), "the project name defaults to the directory name");
  assert.ok(fs.existsSync(path.join(dir, MANIFEST)));
});

test("the gate: a failing guard fails it, a skipped one does not, an empty one is an error", () => {
  const dir = tmp();
  install(dir, []);
  write(dir, "scripts/guards.d/97-skipped.sh", "#!/usr/bin/env bash\nexit 77\n", 0o755);
  let r = gate(dir); assert.equal(r.status, 0, output(r)); assert.match(r.stdout, /skipped: 97-skipped/);
  write(dir, "scripts/guards.d/98-broken.sh", "#!/usr/bin/env bash\nexit 1\n", 0o755);
  r = gate(dir); assert.equal(r.status, 1); assert.match(r.stderr, /FAILED: 98-broken/);
  assert.equal(gate(dir, "--everything").status, 2, "an unknown flag is a usage error, not a pass");
  for (const f of fs.readdirSync(path.join(dir, "scripts/guards.d"))) if (/^\d\d-/.test(f)) fs.rmSync(path.join(dir, "scripts/guards.d", f));
  r = gate(dir); assert.equal(r.status, 1); assert.match(r.stderr, /checked nothing/);
});

test("CM-1 and CM-2: the budget and the pointers of CLAUDE.md are enforced", () => {
  const dir = tmp();
  install(dir, []);
  const original = read(dir, "CLAUDE.md");
  write(dir, "CLAUDE.md", `${original}\n${"x".repeat(26000)}\n`);
  let r = gate(dir); assert.equal(r.status, 1); assert.match(r.stderr, /CM-1: CLAUDE\.md is \d+ bytes, over its budget of 25000/);
  write(dir, "CLAUDE.md", original.replace(/<!-- harness:budget \d+ -->\n/, ""));
  r = gate(dir); assert.equal(r.status, 1); assert.match(r.stderr, /CM-1: CLAUDE\.md has no 'harness:budget/);
  write(dir, "CLAUDE.md", `${original}\n- **Ghost**: a rule. → \`docs/conventions/ghost.md\`\n`);
  r = gate(dir); assert.equal(r.status, 1); assert.match(r.stderr, /CM-2: CLAUDE\.md points to docs\/conventions\/ghost\.md/);
  write(dir, "CLAUDE.md", original);
  assert.equal(gate(dir).status, 0);
});

test("git-hooks: pre-push blocks on a red gate and lets a deletion through", () => {
  if (!kit.modules.has("git-hooks")) return;
  const dir = tmp();
  install(dir, ["git-hooks"]);
  assert.equal(gate(dir).status, 0);
  const push = (line) => run(dir, "sh", [".githooks/pre-push"], { input: line, env: { ...process.env, CI: "" } });
  const real = `refs/heads/main ${"1".repeat(40)} refs/heads/main ${"0".repeat(40)}\n`;
  assert.equal(push(real).status, 0);
  write(dir, "scripts/guards.d/98-broken.sh", "#!/usr/bin/env bash\nexit 1\n", 0o755);
  const blocked = push(real); assert.equal(blocked.status, 1); assert.match(blocked.stderr, /pre-push: the gate failed/);
  assert.equal(push(`(delete) ${"0".repeat(40)} refs/heads/old ${"2".repeat(40)}\n`).status, 0, "a push that only deletes refs skips the gate");
  assert.equal(push("").status, 0);
});
