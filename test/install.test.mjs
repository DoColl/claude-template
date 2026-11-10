// node --test test/*.test.mjs — end-to-end: install modules into a scratch project, run its gate, add, update, conflict.
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
// Under `node --test`, NODE_TEST_CONTEXT is set, and a `node --test` started with it in its environment exits 0
// whatever its tests do. The gate runs the modules' self-tests that way (AG-1, PL-1, WD-1…): without this, a
// broken self-test would pass here and fail in every project.
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "NODE_TEST_CONTEXT"));
const run = (cwd, cmd, args, opts = {}) => spawnSync(cmd, args, { cwd, encoding: "utf8", env: ENV, ...opts });
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", input: "" });
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), "utf8");
const write = (dir, rel, text, mode) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); if (mode) fs.chmodSync(path.join(dir, rel), mode); };
const install = (target, moduleIds, extra = {}) => { const plan = buildPlan({ kit, target, moduleIds, given: { PROJECT_NAME: "demo-app" }, ...extra }); applyPlan(plan); return plan; };

// The gate reads tracked files (AG-2, the TODO count): put the tree in an index first.
function gate(dir, ...args) {
  assert.equal(run(dir, "git", ["init", "-q", "-b", "main"]).status, 0, "git init");
  assert.equal(run(dir, "git", ["add", "-A"]).status, 0, "git add");
  return run(dir, "bash", ["scripts/security-checks.sh", ...(args.length ? args : ["--offline"])], { env: { ...ENV, CI: "" } });
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
  const passes = /\n\n((?:(?:1\. | {3})[^\n]*\n)+)\nInstruction files are executed/.exec(read(dir, "CLAUDE.md"))?.[1].split("\n").filter((l) => l.startsWith("1. "));
  assert.ok(passes?.length >= 5, "the review passes of every module and the built-in ones form one numbered list, with nothing at the left margin between them");
  for (const p of passes) assert.match(p, /^1\. \*\*[^*]+\*\* \(tiers? [23]/, p);
  const again = summarize(buildPlan({ kit, target: dir }));
  assert.deepEqual([again.created, again.updated, again.appended, again.fragmentsInserted, again.conflicts, again.outdated], [[], [], [], [], [], []], "a second run writes nothing");
  assert.deepEqual(drift(dir, readManifest(dir)), { modified: [], missing: [] });
  assert.deepEqual(readManifest(dir).modules, plan.selected);
  const hashed = Object.values(readManifest(dir).files).filter((f) => f.sha256).length;
  assert.match(r.stdout, new RegExp(`HD-1: ${hashed} kit file\\(s\\) identical`), "the guard hashes every kit-owned file the way the installer does");
  assert.doesNotMatch(r.stdout, /HD-1: \d+ kit file\(s\) differ/);
});

// HD-1 lists, without the kit, what `status` lists with it. A note, never a failure: a project may edit a kit file.
test("HD-1: the gate lists the kit files that drifted from their recorded hash, and stays green", () => {
  const dir = tmp();
  install(dir, []);
  write(dir, "scripts/guards.d/_lib.sh", `${read(dir, "scripts/guards.d/_lib.sh")}# edited in the project\n`);
  fs.rmSync(path.join(dir, "docs/conventions/claude-md.md"));
  write(dir, "CLAUDE.md", read(dir, "CLAUDE.md").replace("docs/conventions/claude-md.md", "docs/conventions/local-gate.md"));
  assert.deepEqual(drift(dir, readManifest(dir)), { modified: ["scripts/guards.d/_lib.sh"], missing: ["docs/conventions/claude-md.md"] });
  const r = gate(dir);
  assert.equal(r.status, 0, output(r));
  const listed = /HD-1: 2 kit file\(s\) differ[^\n]*\n((?: {10}[^\n]+\n)+)/.exec(r.stdout)?.[1].trim().split("\n").map((l) => l.trim());
  assert.deepEqual(listed, ["docs/conventions/claude-md.md  (missing)", "scripts/guards.d/_lib.sh"], output(r));
  assert.doesNotMatch(r.stdout, /CLAUDE\.md  /, "a seed carries no hash: filling it is not drift");
  // a manifest the awk cannot read says so instead of reporting a clean tree
  write(dir, MANIFEST, JSON.stringify(readManifest(dir)));
  assert.match(gate(dir).stdout, /HD-1: no hashed file could be read/);
});

// The one-run installation the README and the harness-init skill give for a new repository: day-1 set, CI, unattended merge.
test("day-1 and the pull-request flow install in one run, and the CI workflow carries the name auto-merge waits for", () => {
  const command = /init \. --modules (git-hooks,agents,security-review,ci-security,ci-workflow,auto-merge)\n/;
  const ids = command.exec(read(KIT_ROOT, "README.md"))?.[1];
  assert.ok(ids, "the README gives the command");
  assert.equal(command.exec(read(KIT_ROOT, "skills/harness-init/SKILL.md"))?.[1], ids, "the skill gives the same one");
  const dir = tmp();
  const r = cli("init", dir, "--modules", ids, "--set", "CI_WORKFLOW=Build and test");
  assert.equal(r.status, 0, output(r));
  assert.match(read(dir, ".github/workflows/ci.yml"), /^name: Build and test\n/);
  assert.match(read(dir, ".github/workflows/auto-merge.yml"), /^    workflows: \["Build and test"\]$/m);
  const g = gate(dir);
  assert.equal(g.status, 0, output(g));
  assert.doesNotMatch(g.stdout, /security\.yml is not called by any workflow|no workflow named/, "nothing is left to wire by hand");
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

// A cloned repository can carry a directory symlink that points out of it: the installer must not write
// through it (it would drop agents and hooks into, say, a user-level config directory).
test("nothing is written through a symlink that leaves the project", () => {
  const cases = { "a symlinked scripts/": "scripts", "a symlinked .claude/": ".claude", "a symlinked docs/": "docs" };
  for (const [label, link] of Object.entries(cases)) {
    const dir = tmp(), outside = tmp("harness-outside-");
    fs.symlinkSync(outside, path.join(dir, link), "dir");
    const r = cli("init", dir, "--all");
    assert.equal(r.status, 1, `${label}: ${output(r)}`);
    assert.match(r.stderr, /resolves outside the project/, label);
    assert.deepEqual(fs.readdirSync(outside), [], `${label}: nothing landed outside`);
    assert.deepEqual(fs.readdirSync(dir), [link], `${label}: nothing was written in the project either — the plan is refused as a whole`);
    assert.equal(cli("init", dir, "--all", "--force").status, 1, `${label}: --force does not change that`);
    assert.deepEqual(fs.readdirSync(outside), []);
  }
  // the manifest itself as a link, and a link to nowhere
  const dir = tmp(), outside = tmp("harness-outside-");
  write(outside, "harness.json", "{}");
  fs.mkdirSync(path.join(dir, ".claude"));
  fs.symlinkSync(path.join(outside, "harness.json"), path.join(dir, ".claude/harness.json"));
  const linked = cli("init", dir, "--modules", "core");
  assert.equal(linked.status, 1); assert.match(linked.stderr, /harness\.json exists and is not a regular file/);
  assert.equal(read(outside, "harness.json"), "{}");
  const broken = tmp();
  fs.symlinkSync(path.join(broken, "nowhere"), path.join(broken, "docs"));
  assert.equal(cli("init", broken, "--modules", "core").status, 1);
  // a file where a directory is expected is refused before anything is written
  const blocked = tmp();
  write(blocked, "scripts", "not a directory\n");
  const b = cli("init", blocked, "--modules", "core");
  assert.equal(b.status, 1); assert.match(b.stderr, /scripts exists and is not a directory/); assert.deepEqual(fs.readdirSync(blocked), ["scripts"]);
  // a project reached through a symlink is still a project; so is one whose subdirectory links inside itself
  const real = tmp(), viaLink = path.join(tmp(), "link");
  fs.symlinkSync(real, viaLink, "dir");
  fs.mkdirSync(path.join(real, "documentation")); fs.symlinkSync(path.join(real, "documentation"), path.join(real, "docs"), "dir");
  const ok = cli("init", viaLink, "--modules", "core"); assert.equal(ok.status, 0, output(ok));
  assert.ok(fs.existsSync(path.join(real, "documentation/conventions/README.md")), "a link that stays inside the project is followed");
});

test("the gate: a failing guard fails it, a skipped one does not, an empty one is an error", () => {
  const dir = tmp();
  install(dir, []);
  // a self-test run with `node --test` that fails must fail the gate from inside this test run too
  write(dir, "scripts/red.test.mjs", 'import { test } from "node:test";\nimport assert from "node:assert/strict";\ntest("red", () => assert.equal(1, 2));\n');
  write(dir, "scripts/guards.d/96-self-test.sh", '#!/usr/bin/env bash\n. "$(dirname "$0")/_lib.sh"\nif node --test scripts/red.test.mjs >/dev/null 2>&1; then ok "self-test"; else fail "self-test"; fi\nfinish\n', 0o755);
  let nested = gate(dir); assert.equal(nested.status, 1, "a nested test run reports its failures"); assert.match(nested.stderr, /FAILED: 96-self-test/);
  fs.rmSync(path.join(dir, "scripts/guards.d/96-self-test.sh"));
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

// Right after an installation nothing is staged: AG-2 must say what to do, not turn the first gate red.
// Once the harness is in git (its manifest is tracked), a hook file left out is the failure it always was.
test("AG-2: untracked hook files are a note before the first git add, a failure after it and on a runner", () => {
  if (!kit.modules.has("agents")) return;
  const dir = tmp();
  install(dir, ["agents"]);
  assert.equal(run(dir, "git", ["init", "-q", "-b", "main"]).status, 0);
  const bare = (env = {}) => run(dir, "bash", ["scripts/security-checks.sh", "--offline"], { env: { ...ENV, CI: "", ...env } });
  let r = bare();
  assert.equal(r.status, 0, output(r));
  assert.match(r.stdout, /note\s+AG-2: \d+ hook file\(s\) not in git yet[^\n]*git add -A/);
  r = bare({ CI: "true" });
  assert.equal(r.status, 1, "a runner only has tracked files: no leniency there");
  assert.match(r.stderr, /AG-2: [^\n]* is not tracked by git/);
  assert.equal(run(dir, "git", ["add", ".claude/harness.json", "scripts"]).status, 0);
  r = bare();
  assert.equal(r.status, 1, "the harness is in git and the hooks are not");
  assert.match(r.stderr, /AG-2: \.claude\/hooks\/agent-bash-guard\.mjs is not tracked by git/);
  write(dir, ".gitignore", `${read(dir, ".gitignore")}.claude/hooks/\n`);
  fs.rmSync(path.join(dir, ".git"), { recursive: true });
  assert.equal(run(dir, "git", ["init", "-q", "-b", "main"]).status, 0);
  r = bare();
  assert.equal(r.status, 1, "an ignored hook file fails even before anything is staged");
  assert.match(r.stderr, /AG-2: [^\n]* matches a \.gitignore rule/);
});

test("git-hooks: pre-push blocks on a red gate and lets a deletion through", () => {
  if (!kit.modules.has("git-hooks")) return;
  const dir = tmp();
  install(dir, ["git-hooks"]);
  assert.equal(gate(dir).status, 0);
  const push = (line) => run(dir, "sh", [".githooks/pre-push"], { input: line, env: { ...ENV, CI: "" } });
  const real = `refs/heads/main ${"1".repeat(40)} refs/heads/main ${"0".repeat(40)}\n`;
  assert.equal(push(real).status, 0);
  write(dir, "scripts/guards.d/98-broken.sh", "#!/usr/bin/env bash\nexit 1\n", 0o755);
  const blocked = push(real); assert.equal(blocked.status, 1); assert.match(blocked.stderr, /pre-push: the gate failed/);
  assert.equal(push(`(delete) ${"0".repeat(40)} refs/heads/old ${"2".repeat(40)}\n`).status, 0, "a push that only deletes refs skips the gate");
  assert.equal(push("").status, 0);
});
