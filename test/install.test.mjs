// node --test test/*.test.mjs — end-to-end: install modules into a scratch project, run its gate, add, update, conflict.
// Needs git and bash. The gate runs offline, and with CI unset so a guard whose tool is missing skips.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { entries as changelogEntries, byHandBetween } from "../lib/changelog.mjs";
import { nextVersion } from "../lib/release.mjs";
import { loadKit, listModules, KIT_ROOT } from "../lib/kit.mjs";
import { buildPlan, applyPlan, buildRemoval, applyRemoval, summarize, readManifest, drift, walk, MANIFEST } from "../lib/install.mjs";

const kit = loadKit();
const CLI = path.join(KIT_ROOT, "bin/harness.mjs");
const ALL = listModules(kit).map((m) => m.id);
const tmp = (prefix = "harness-e2e-") => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
// Under `node --test`, NODE_TEST_CONTEXT is set, and a `node --test` started with it in its environment exits 0
// whatever its tests do. The gate runs the modules' self-tests that way (AG-1, PL-1, WD-1…), so the guards clear it
// (_lib.sh). gate() below starts the gate with it set, however this suite is run: as a project's own tests would.
const ENV = process.env;
const run = (cwd, cmd, args, opts = {}) => spawnSync(cmd, args, { cwd, encoding: "utf8", env: ENV, ...opts });
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", input: "" });
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), "utf8");
const write = (dir, rel, text, mode) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); if (mode) fs.chmodSync(path.join(dir, rel), mode); };
const install = (target, moduleIds, extra = {}) => { const plan = buildPlan({ kit, target, moduleIds, given: { PROJECT_NAME: "demo-app" }, ...extra }); applyPlan(plan); return plan; };

// The gate reads tracked files (AG-2, the TODO count): put the tree in an index first.
function gate(dir, ...args) {
  assert.equal(run(dir, "git", ["init", "-q", "-b", "main"]).status, 0, "git init");
  assert.equal(run(dir, "git", ["add", "-A"]).status, 0, "git add");
  return run(dir, "bash", ["scripts/security-checks.sh", ...(args.length ? args : ["--offline"])], { env: { ...ENV, CI: "", NODE_TEST_CONTEXT: "child-v8" } });
}
const output = (r) => `${r.stdout}\n${r.stderr}`;

// A directory of links to a few commands, given to a guard as its whole PATH. Each command is linked from a place
// where it works alone: some sessions put a stand-in first on PATH — an `rm` that refuses, or one that hands over to
// the next `rm` on PATH and finds none in such a directory. So every place PATH names is tried, and for a command
// with a probe the first copy that does its job is the one linked. Returns the names with no working copy.
const PROBES = {
  rm: (exe) => {
    const dir = tmp("harness-probe-"), file = path.join(dir, "file"), bin = path.join(dir, "bin");
    fs.writeFileSync(file, ""); fs.mkdirSync(bin); fs.symlinkSync(exe, path.join(bin, "rm"));
    spawnSync(path.join(bin, "rm"), [file], { env: { PATH: bin } });
    const deleted = !fs.existsSync(file);
    fs.rmSync(dir, { recursive: true, force: true });
    return deleted;
  },
};
function linkTools(bin, tools) {
  const missing = [];
  for (const tool of tools) {
    const places = run(os.tmpdir(), "bash", ["-c", `type -aP ${tool}`]).stdout.split("\n").filter((p) => path.isAbsolute(p));
    const found = places.find((p) => !PROBES[tool] || PROBES[tool](p));
    if (found) fs.symlinkSync(found, path.join(bin, tool)); else missing.push(tool);
  }
  return missing;
}
// On a CI runner every command is there and works: a missing one is a failure. Elsewhere, a machine where no `rm`
// deletes says so and the test is skipped, rather than failing on an assertion that is not about the change.
function noWorkingRm(t, missing) {
  if (process.env.CI || !missing.includes("rm")) return false;
  t.skip("no rm on this machine's PATH deletes a file when it is run alone: the guard cannot be exercised here");
  return true;
}

// What a session loads of CLAUDE.md: the file without its block-level HTML comments. Same narrow definition as CM-1
// (a comment opening at column 0, outside a code fence, whose closing --> ends its line), written a second time here
// on purpose: the test below compares the two.
function loadedBytes(text) {
  let hidden = 0, pending = 0, inComment = false, fence = "";
  for (const line of text.split("\n").slice(0, text.endsWith("\n") ? -1 : undefined)) {
    const len = Buffer.byteLength(line) + 1;
    if (inComment) {
      const i = line.indexOf("-->");
      if (i < 0) { pending += len; continue; }
      if (!line.slice(i + 3).trim()) hidden += pending + len;
      inComment = false; pending = 0; continue;
    }
    const f = /^ {0,3}(```|~~~)/.exec(line)?.[1][0] ?? "";
    if (fence) { if (f === fence) fence = ""; continue; }
    if (f) { fence = f; continue; }
    if (line.startsWith("<!--")) {
      const i = line.indexOf("-->");
      if (i < 0) { inComment = true; pending = len; continue; }
      if (!line.slice(i + 3).trim()) hidden += len;
    }
  }
  return Buffer.byteLength(text) - hidden;
}

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
  const size = loadedBytes(read(dir, "CLAUDE.md"));
  assert.match(r.stdout, new RegExp(`CM-1: CLAUDE\\.md loads ${size} bytes into a session`), "the guard and this test count the same bytes");
  assert.ok(size <= budget * 0.6, `CLAUDE.md loads ${size} bytes with every module: leave the project at least 40% of its ${budget}-byte budget`);
  const rules = fs.readdirSync(path.join(dir, ".claude/rules"));
  assert.ok(rules.length >= 4, "the path-scoped rules are installed");
  assert.equal(run(dir, "git", ["check-ignore", "-q", `.claude/rules/${rules[0]}`]).status, 1, "a rule file is not ignored by git: it is shared, like an agent");
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
  assert.match(read(dir, ".github/workflows/auto-merge.yml"), /^    workflows: \["Build and test", "Claude review"\]$/m);
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

// A project takes the kit's changes piece by piece: one module, one file or one directory. What the selection
// leaves out stays recorded as installed, so the next update — or --check — still lists it.
test("update --modules / --only refreshes the selection and leaves the rest behind, still listed", () => {
  const root = tmp("harness-kitcopy-"), dir = tmp();
  for (const rel of ["kit.json", "modules/core", "modules/git-hooks"]) fs.cpSync(path.join(KIT_ROOT, rel), path.join(root, rel), { recursive: true });
  applyPlan(buildPlan({ kit: loadKit(root), target: dir, moduleIds: ["git-hooks"], given: { PROJECT_NAME: "demo-app" } }));
  const before = readManifest(dir);
  const core = path.join(root, "modules/core/files"), hooks = path.join(root, "modules/git-hooks/files");
  for (const rel of ["scripts/guards.d/_lib.sh", "scripts/security-checks.sh"]) write(core, rel, `${read(core, rel)}# kit v2\n`, 0o755);
  write(core, "docs/conventions/new-page.md", "# New in v2\n");
  write(hooks, ".githooks/pre-push", `${read(hooks, ".githooks/pre-push")}# kit v2\n`, 0o755);
  fs.writeFileSync(path.join(root, "kit.json"), JSON.stringify({ name: "claude-template", version: "9.9.9" }));
  const up = (...args) => spawnSync(process.execPath, [path.join(root, "bin/harness.mjs"), "update", dir, ...args], { encoding: "utf8", input: "" });
  for (const rel of ["bin", "lib"]) fs.cpSync(path.join(KIT_ROOT, rel), path.join(root, rel), { recursive: true });

  const check = up("--check"); assert.equal(check.status, 3, output(check)); assert.match(check.stdout, /behind the kit: 4 item/);
  assert.deepEqual(readManifest(dir), before, "--check writes nothing");
  assert.equal(up("--modules", "agents").status, 1, "a module that is not installed");
  assert.equal(up("--only", "no/such/file").status, 1);
  assert.equal(up("--all").status, 1);

  const one = up("--modules", "git-hooks"); assert.equal(one.status, 0, output(one));
  assert.match(read(dir, ".githooks/pre-push"), /# kit v2\n$/);
  assert.doesNotMatch(read(dir, "scripts/guards.d/_lib.sh"), /# kit v2/, "core was not selected");
  assert.ok(!fs.existsSync(path.join(dir, "docs/conventions/new-page.md")));
  assert.match(one.stdout, /not selected — still behind the kit \(3\)/);
  assert.equal(readManifest(dir).kit.version, before.kit.version, "the manifest names the new kit only once every file follows it");
  assert.equal(up("--check", "--modules", "git-hooks").status, 0, "the selection is in step");
  assert.equal(up("--check").status, 3, "the project is not");

  const file = up("--only", "./scripts/guards.d/"); assert.equal(file.status, 0, output(file));
  assert.match(read(dir, "scripts/guards.d/_lib.sh"), /# kit v2\n$/);
  assert.doesNotMatch(read(dir, "scripts/security-checks.sh"), /# kit v2/, "a sibling of the directory is not under it");
  assert.equal(readManifest(dir).kit.version, before.kit.version);

  const rest = up(); assert.equal(rest.status, 0, output(rest));
  assert.equal(readManifest(dir).kit.version, "9.9.9");
  assert.equal(up("--check").status, 0);
  assert.equal(gate(dir).status, 0);
});

// A repository that grew its own hooks, guards and workflows before the kit: `init` leaves each of them as an
// unrecorded conflict, on every run. `adopt` records them as what they are — kit files edited in the project.
test("adopt keeps the project's own version of a kit file and records it as edited here", () => {
  const root = kitCopy(), dir = tmp(), v1 = loadKit(root);
  for (const rel of ["bin", "lib"]) fs.cpSync(path.join(KIT_ROOT, rel), path.join(root, rel), { recursive: true });
  const ref = tmp(); applyPlan(buildPlan({ kit: v1, target: ref, given: { PROJECT_NAME: "demo-app" } }));
  const own = "#!/usr/bin/env bash\n# the project's own gate\nexit 0\n";
  write(dir, "scripts/security-checks.sh", own, 0o755);
  write(dir, "scripts/guards.d/_lib.sh", read(ref, "scripts/guards.d/_lib.sh"));
  write(dir, "CLAUDE.md", "# Written before the kit\n");
  const h = (...args) => spawnSync(process.execPath, [path.join(root, "bin/harness.mjs"), ...args], { encoding: "utf8", input: "" });

  const init = h("init", dir, "--modules", "core", "--set", "PROJECT_NAME=demo-app", "--dry-run");
  assert.equal(init.status, 2, "init calls it a conflict"); assert.match(init.stdout, /CONFLICTS[\s\S]*scripts\/security-checks\.sh/);
  assert.equal(h("adopt", dir, "--modules", "core", "--force").status, 1);
  const shown = h("show", dir, "scripts/security-checks.sh", "--modules", "core", "--set", "PROJECT_NAME=demo-app");
  assert.equal(shown.status, 0, output(shown)); assert.equal(shown.stdout, read(ref, "scripts/security-checks.sh"), "show prints the kit's version");
  assert.equal(h("show", dir, "no/such/file", "--modules", "core").status, 1);

  const r = h("adopt", dir, "--modules", "core", "--set", "PROJECT_NAME=demo-app");
  assert.equal(r.status, 0, output(r));
  assert.match(r.stdout, /adopted — [^\n]*\(1\)\n  scripts\/security-checks\.sh  \[core\]  \+\d+ \/ -\d+/);
  assert.equal(read(dir, "scripts/security-checks.sh"), own, "the project's file is not touched");
  assert.equal(read(dir, "CLAUDE.md"), "# Written before the kit\n", "nor its seed");
  const m = readManifest(dir);
  assert.equal(m.files["scripts/security-checks.sh"].sha256, readManifest(ref).files["scripts/security-checks.sh"].sha256, "recorded with the hash of the kit's version");
  assert.deepEqual(drift(dir, m).modified, ["scripts/security-checks.sh"], "status lists it as edited here");
  assert.equal(h("update", dir, "--check").status, 0, "and the project is not behind the kit");
  assert.equal(h("adopt", dir, "--modules", "core").status, 0, "adopting again changes nothing");
  assert.deepEqual(readManifest(dir), m);

  // the kit changes that file: a human decides, as for any kit file edited in a project
  const coreFiles = path.join(root, "modules/core/files");
  write(coreFiles, "scripts/security-checks.sh", `${read(coreFiles, "scripts/security-checks.sh")}# kit v2\n`, 0o755);
  const s = summarize(buildPlan({ kit: loadKit(root), target: dir, mode: "update" }));
  assert.deepEqual(s.conflicts, [{ file: "scripts/security-checks.sh", why: "modified here and changed in the kit" }]);
  assert.deepEqual(summarize(buildPlan({ kit: loadKit(root), target: dir, mode: "adopt" })).adopted, [], "a recorded file is never adopted over: that conflict stays one");
});

// A kit file the project edited and the kit then changed: the installed version is looked up in the kit's
// history (the recorded hash names it), and the two sets of changes are merged when they do not overlap.
test("update --merge merges a kit file edited on both sides, and leaves an overlap to a human", () => {
  const root = kitCopy(), dir = tmp();
  for (const rel of ["bin", "lib"]) fs.cpSync(path.join(KIT_ROOT, rel), path.join(root, rel), { recursive: true });
  const g = (...args) => { const r = run(root, "git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args]); assert.equal(r.status, 0, output(r)); };
  const coreFiles = path.join(root, "modules/core/files"), page = "docs/conventions/local-gate.md", lib = "scripts/guards.d/_lib.sh";
  write(coreFiles, "docs/extra/steps.md", "one\ntwo\nthree\nfour\nfive\nsix\nseven\n");
  g("init", "-q", "-b", "main"); g("add", "-A"); g("commit", "-q", "-m", "v1");
  applyPlan(buildPlan({ kit: loadKit(root), target: dir, given: { PROJECT_NAME: "demo-app" } }));
  // the project edits the top of one file and the middle of another; the kit edits the bottom of the first,
  // the same middle line of the second, and a third file the project also edited — in a kit without history
  write(dir, "docs/extra/steps.md", "one (project)\ntwo\nthree\nfour\nfive\nsix\nseven\n");
  write(dir, page, read(dir, page).replace(/^# .*$/m, "# The project's title"));
  write(dir, lib, `${read(dir, lib)}# project\n`, 0o755);
  write(coreFiles, "docs/extra/steps.md", "one\ntwo\nthree\nfour\nfive\nsix\nseven (kit v2)\n");
  write(coreFiles, page, read(coreFiles, page).replace(/^# .*$/m, "# The kit's new title"));
  write(coreFiles, lib, `${read(coreFiles, lib)}# kit v2\n`, 0o755);
  g("add", "-A"); g("commit", "-q", "-m", "v2");
  const up = (...args) => spawnSync(process.execPath, [path.join(root, "bin/harness.mjs"), "update", dir, ...args], { encoding: "utf8", input: "" });

  const plain = up("--dry-run"); assert.equal(plain.status, 2); assert.match(plain.stdout, /CONFLICTS[^\n]*\(3\)/, "without --merge, three conflicts");
  assert.equal(up("--merge", "--force").status, 1);
  const before = read(dir, page);
  const r = up("--merge", "--only", "docs"); assert.equal(r.status, 2, output(r));
  assert.match(r.stdout, /merged — [^\n]*\(1\)\n  docs\/extra\/steps\.md/);
  assert.equal(read(dir, "docs/extra/steps.md"), "one (project)\ntwo\nthree\nfour\nfive\nsix\nseven (kit v2)\n", "both changes are in");
  assert.match(r.stdout, /local-gate\.md  \(modified here and changed in the kit; the two changes overlap in 1 place/);
  assert.equal(read(dir, page), before, "an overlap leaves the file as it was: no conflict marker is ever written");
  assert.match(r.stdout, /not selected — still behind the kit[\s\S]*_lib\.sh/);
  assert.deepEqual(drift(dir, readManifest(dir)).modified.sort(), [page, "docs/extra/steps.md", lib].sort(), "a merged file is still one the project edited");
  assert.match(up("--merge", "--check").stdout, /left alone — edited in the project, unchanged in the kit \(1\)\n  docs\/extra\/steps\.md/, "and it is in step with the kit");

  // the same kit without its history (an unpacked archive): nothing to merge from
  fs.rmSync(path.join(root, ".git"), { recursive: true });
  const bare = up("--merge", "--dry-run"); assert.equal(bare.status, 2);
  assert.match(bare.stdout, /_lib\.sh  \(modified here and changed in the kit; the version installed was not found in the kit's history\)/);
});

test("adopt --decline-fragments records the sections a slotless file will not take, once", () => {
  const dir = tmp();
  write(dir, "CLAUDE.md", "# Written before the kit, without slots\n");
  const first = cli("adopt", dir, "--modules", "agents", "--dry-run");
  assert.match(first.stdout, /fragments NOT inserted[^\n]*\((\d+)\)/); assert.match(first.stdout, /by module\s+created/);
  const n = Number(first.stdout.match(/fragments NOT inserted[^\n]*\((\d+)\)/)[1]);
  assert.equal(cli("init", dir, "--modules", "agents", "--decline-fragments").status, 1, "adopt only");
  const r = cli("adopt", dir, "--modules", "agents", "--decline-fragments"); assert.equal(r.status, 0, output(r));
  assert.match(r.stdout, new RegExp(`fragments declined[^\\n]*\\(${n}\\)`));
  assert.equal(read(dir, "CLAUDE.md"), "# Written before the kit, without slots\n");
  const m = readManifest(dir);
  assert.equal(m.declined.length, n); assert.ok(m.declined.every((k) => !m.fragments.includes(k)), "declined is not inserted");
  const again = cli("update", dir, "--check"); assert.equal(again.status, 0, output(again));
  assert.doesNotMatch(again.stdout, /fragments NOT inserted/, "they are not proposed again");
  assert.deepEqual(readManifest(dir).declined, m.declined, "and an update keeps the record");
  assert.match(cli("status", dir).stdout, new RegExp(`sections declined at adoption[^\\n]*\\(${n}\\)`));
});

// A file the kit stops shipping is the kit's to take back, as long as the project left it as installed.
test("update removes what the kit no longer ships when it is untouched, and only then", () => {
  const root = kitCopy(), dir = tmp();
  const coreFiles = path.join(root, "modules/core/files");
  write(coreFiles, "docs/extra/gone.md", "# Leaves in v2\n");
  write(coreFiles, "docs/extra/edited.md", "# Leaves in v2 too\n");
  write(coreFiles, "docs/extra/late.md", "# Leaves in v2 as well\n");
  applyPlan(buildPlan({ kit: loadKit(root), target: dir, given: { PROJECT_NAME: "demo-app" } }));
  write(dir, "docs/extra/edited.md", "# Leaves in v2 too\nProject note.\n");
  write(dir, "docs/extra/mine.md", "# The project's own\n");
  fs.rmSync(path.join(coreFiles, "docs/extra"), { recursive: true });
  const v2 = loadKit(root);

  const asAdd = buildPlan({ kit: v2, target: dir });
  assert.deepEqual(summarize(asAdd).removed, [], "init and add never delete");
  applyPlan(asAdd);
  assert.ok(readManifest(dir).files["docs/extra/gone.md"], "and keep the record, so that an update still can");

  const partial = buildPlan({ kit: v2, target: dir, mode: "update", select: (m, rel) => rel === "docs/extra/gone.md" });
  assert.deepEqual(summarize(partial).removed, ["docs/extra/gone.md"]);
  applyPlan(partial);
  assert.ok(!fs.existsSync(path.join(dir, "docs/extra/gone.md")));
  assert.ok(fs.existsSync(path.join(dir, "docs/extra/late.md")), "outside the selection");

  const plan = buildPlan({ kit: v2, target: dir, mode: "update" });
  const s = summarize(plan);
  assert.deepEqual(s.removed, ["docs/extra/late.md"]);
  assert.deepEqual(s.dropped, ["docs/extra/edited.md"], "edited here: a human decides");
  applyPlan(plan);
  assert.deepEqual(fs.readdirSync(path.join(dir, "docs/extra")).sort(), ["edited.md", "mine.md"], "the project's files and its edits stay");
  assert.deepEqual(Object.keys(readManifest(dir).files).filter((f) => f.startsWith("docs/extra/")), []);
  const again = summarize(buildPlan({ kit: v2, target: dir, mode: "update" }));
  assert.deepEqual([again.removed, again.dropped], [[], []]);

  // the path comes from the manifest, which the project can write: nothing outside it is removed
  const outside = path.join(tmp(), "victim.txt"); fs.writeFileSync(outside, "x");
  const m = readManifest(dir);
  m.files[path.relative(dir, outside)] = { module: "core", sha256: "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881" };
  fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify(m, null, 2));
  assert.throws(() => buildPlan({ kit: v2, target: dir, mode: "update" }), /outside the project/);
  assert.ok(fs.existsSync(outside));
});

// What a project looks like, manifest included: every file but git's.
const tree = (dir) => Object.fromEntries(walk(dir).filter((rel) => !rel.startsWith(".git/")).map((rel) => [rel, read(dir, rel)]));

for (const id of ALL.filter((m) => !kit.modules.get(m).required)) {
  test(`remove ${id}: an untouched project ends as if the module had never been installed`, () => {
    // with it go the modules that require it, named in the same run
    const going = ALL.filter((m) => { const seen = new Set(); const needs = (x) => x === id || (!seen.has(x) && (seen.add(x), (kit.modules.get(x).requires ?? []).some(needs))); return needs(m); });
    const dir = tmp(), fresh = tmp();
    install(dir, ALL);
    const plan = buildRemoval({ kit, target: dir, moduleIds: going });
    assert.deepEqual([plan.keptSeeds, plan.keptEdited, plan.fragmentsLeft, plan.blocksLeft], [[], [], [], []]);
    applyRemoval(plan);
    install(fresh, ALL.filter((m) => !going.includes(m)));
    assert.deepEqual(tree(dir), tree(fresh));
  });
}

test("remove deletes nothing the project wrote, names what it leaves, and refuses a module another one stands on", () => {
  if (!["agents", "security-review", "headroom", "node-audit"].every((m) => kit.modules.has(m))) return;
  const dir = tmp();
  install(dir, ["agents", "security-review", "headroom", "node-audit"]);
  const before = tree(dir);
  // refusals: nothing is written
  const needed = cli("remove", dir, "--modules", "agents"); assert.equal(needed.status, 1); assert.match(needed.stderr, /security-review requires agents.*--modules agents,security-review/);
  assert.match(cli("remove", dir, "--modules", "core").stderr, /core is always installed/);
  assert.match(cli("remove", dir, "--modules", "auto-merge").stderr, /auto-merge is not installed here/);
  assert.match(cli("remove", dir).stderr, /expects --modules/);
  assert.match(cli("remove", dir, "--all").stderr, /name what goes/);
  assert.match(cli("remove", tmp(), "--modules", "agents").stderr, /is not initialised/);
  assert.deepEqual(tree(dir), before);

  // what the project wrote: a kit file edited, a seed filled in, a section reworded, a line of its own in a block
  const scribble = (d) => {
    fs.appendFileSync(path.join(d, "scripts/guards.d/48-headroom.sh"), "# ours\n");
    fs.appendFileSync(path.join(d, "scripts/audit-allowlist.json"), "\n");
    write(d, "CLAUDE.md", read(d, "CLAUDE.md").replace("- **Headroom**", "- **Headroom, here**"));
    write(d, ".gitignore", read(d, ".gitignore").replace("# <<< claude-template:headroom", "ours/\n# <<< claude-template:headroom"));
  };
  scribble(dir);
  const edited = tree(dir);
  const dry = cli("remove", dir, "--modules", "headroom,node-audit", "--dry-run");
  assert.equal(dry.status, 2, output(dry)); assert.match(dry.stdout, /dry run, nothing written/); assert.deepEqual(tree(dir), edited);
  const r = cli("remove", dir, "--modules", "headroom,node-audit");
  assert.equal(r.status, 2, output(r));
  assert.match(r.stdout, /kept — project-owned[^\n]*\n  scripts\/audit-allowlist\.json/);
  assert.match(r.stdout, /LEFT IN PLACE[^\n]*\n  scripts\/guards\.d\/48-headroom\.sh/);
  assert.match(r.stdout, /sections NOT taken out[^\n]*\n  CLAUDE\.md  \(modules\/headroom\/fragments\/CLAUDE\.md\/conventions\.frag\)/);
  assert.match(r.stdout, /blocks NOT taken out[^\n]*\n  \.gitignore  \(# >>> claude-template:headroom\)/);
  for (const rel of ["scripts/guards.d/48-headroom.sh", "scripts/audit-allowlist.json", ".gitignore"]) assert.equal(read(dir, rel), edited[rel], rel);
  assert.match(read(dir, "CLAUDE.md"), /Headroom, here/); assert.doesNotMatch(read(dir, "CLAUDE.md"), /npm audit gate/);
  assert.ok(!fs.existsSync(path.join(dir, "docs/conventions/headroom.md")) && !fs.existsSync(path.join(dir, "scripts/audit-gate.mjs")), "the untouched files are gone");
  const m = readManifest(dir);
  assert.deepEqual(m.modules, ["core", "agents", "security-review"]);
  assert.ok(!Object.values(m.files).some((f) => ["headroom", "node-audit"].includes(f.module)) && !m.fragments.some((k) => /^(headroom|node-audit):/.test(k)));
  assert.deepEqual(drift(dir, m), { modified: [], missing: [] });
  // the same module again: what was left is found as it is, and the project's lines survive
  assert.equal(cli("add", dir, "--modules", "headroom").status, 2, "the edited guard is now a file of the project's at a kit path");

  // --force: the edited kit file and the edited block go too; a filled seed and a reworded section never do
  const forced = tmp();
  install(forced, ["headroom", "node-audit"]);
  scribble(forced);
  const f = cli("remove", forced, "--modules", "headroom,node-audit", "--force");
  assert.equal(f.status, 2, output(f));
  assert.ok(!fs.existsSync(path.join(forced, "scripts/guards.d/48-headroom.sh")));
  assert.doesNotMatch(read(forced, ".gitignore"), /headroom|ours/);
  assert.ok(fs.existsSync(path.join(forced, "scripts/audit-allowlist.json")));
  assert.match(read(forced, "CLAUDE.md"), /Headroom, here/);
  // the section left behind points at a page that is gone: the gate names it until it is reworded or removed
  const g = gate(forced); assert.equal(g.status, 1, output(g)); assert.match(output(g), /CM-2: CLAUDE\.md points to docs\/conventions\/headroom\.md/);
  write(forced, "CLAUDE.md", read(forced, "CLAUDE.md").split("\n").filter((l) => !l.includes("Headroom, here")).join("\n"));
  const green = gate(forced); assert.equal(green.status, 0, output(green));
});

// The paths remove deletes come from the manifest, a file of the project: a cloned repository can name anything there.
test("remove deletes nothing outside the project, whatever the manifest names", () => {
  if (!kit.modules.has("headroom")) return;
  const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");
  const outside = tmp("harness-outside-");
  write(outside, "victim.txt", "keep\n");
  const cases = {
    "a path that climbs out": (dir) => path.relative(dir, path.join(outside, "victim.txt")).split(path.sep).join("/"),
    "a directory symlink": (dir) => { fs.symlinkSync(outside, path.join(dir, "linked"), "dir"); return "linked/victim.txt"; },
  };
  for (const [label, rel] of Object.entries(cases)) {
    const dir = tmp();
    install(dir, ["headroom"]);
    const m = readManifest(dir);
    m.files[rel(dir)] = { module: "headroom", sha256: sha("keep\n") };
    write(dir, MANIFEST, JSON.stringify(m));
    const before = [read(dir, MANIFEST), walk(path.join(dir, "docs")), walk(path.join(dir, "scripts")), read(dir, "CLAUDE.md"), read(dir, ".gitignore")];
    for (const extra of [[], ["--force"]]) {
      const r = cli("remove", dir, "--modules", "headroom", ...extra);
      assert.equal(r.status, 1, `${label}: ${output(r)}`); assert.match(r.stderr, /resolves outside the project/, label);
    }
    assert.equal(read(outside, "victim.txt"), "keep\n", label);
    assert.deepEqual([read(dir, MANIFEST), walk(path.join(dir, "docs")), walk(path.join(dir, "scripts")), read(dir, "CLAUDE.md"), read(dir, ".gitignore")], before, `${label}: the removal is refused as a whole`);
  }
  // a link to a file is not a file of the kit's: it stays, and so does what it points at
  const dir = tmp();
  install(dir, ["headroom"]);
  const m = readManifest(dir);
  fs.symlinkSync(path.join(outside, "victim.txt"), path.join(dir, "link.txt"));
  m.files["link.txt"] = { module: "headroom", sha256: sha("keep\n") };
  write(dir, MANIFEST, JSON.stringify(m));
  const r = cli("remove", dir, "--modules", "headroom", "--force");
  assert.equal(r.status, 2, output(r)); assert.match(r.stdout, /LEFT IN PLACE[^\n]*\n  link\.txt/);
  assert.equal(read(outside, "victim.txt"), "keep\n");
});

test("the manifest names the commit of the kit's checkout, and versions agree across the kit", () => {
  const dir = tmp();
  install(dir, []);
  const head = run(KIT_ROOT, "git", ["rev-parse", "HEAD"]).stdout.trim();
  if (head) assert.ok(readManifest(dir).kit.commit.startsWith(head), "the commit installed from");
  assert.equal(readManifest(KIT_ROOT)?.kit.commit, undefined, "the kit's own root records no commit: it cannot name itself");
  assert.equal(loadKit(kitCopy()).commit, undefined, "a copy that is not a checkout has none, whatever repository sits above it");
  versionsAgree(KIT_ROOT);
});

// kit.json, package.json, the kit's own installation and the first entry of CHANGELOG.md name one version, and every
// entry has its one "By hand" part. Held for the kit as it is, and below for a release just cut by bin/release.mjs.
function versionsAgree(root) {
  const { version } = loadKit(root), changelog = read(root, "CHANGELOG.md");
  assert.equal(JSON.parse(read(root, "package.json")).version, version);
  const own = readManifest(root);
  if (own) assert.equal(own.kit.version, version, "the kit's own installation records the current version: `node bin/harness.mjs update .`");
  assert.match(changelog, new RegExp(`^## ${version.replaceAll(".", "\\.")}( |$)`, "m"), "the current version has its entry in CHANGELOG.md");
  assert.equal(changelog.match(/^## (\d+\.\d+\.\d+)/m)[1], version, "and it is the first one");
  for (const block of changelog.split(/^(?=## \d)/m).slice(1)) assert.equal((block.match(/^By hand\b/gm) ?? []).length, 1, `CHANGELOG.md: one "By hand" part per entry — a second one is an entry that lost its heading:\n${block.slice(0, 80)}`);
  for (const e of changelogEntries(root)) assert.notEqual(e.byHand, null, `CHANGELOG.md § ${e.version} has no "By hand" part ("By hand: nothing." when there is none)`);
}

// A release of the kit (bin/release.mjs): the fragments under changes/ become the next version, written everywhere
// versionsAgree reads it, and one entry at the top of CHANGELOG.md. It runs on a committed tree only, so that a
// release holds the fragments as merged and nothing else.
test("release: two fragments become the next version and one entry, the fragments go, the root manifest follows", () => {
  if (!readManifest(KIT_ROOT)) return; // a copy of the kit without its own harness: no root manifest to follow
  const root = tmp("harness-release-");
  const skip = [".git", ".claude/worktrees", "changes", "node_modules"].map((rel) => path.join(KIT_ROOT, rel));
  fs.cpSync(KIT_ROOT, root, { recursive: true, filter: (src) => !skip.includes(src) });
  const git = (...args) => { const r = run(root, "git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args]); assert.equal(r.status, 0, output(r)); return r.stdout; };
  const release = (...args) => run(root, process.execPath, [path.join(root, "bin/release.mjs"), ...args], { input: "" });
  git("init", "-q", "-b", "main"); git("add", "-A"); git("commit", "-qm", "the kit");
  const from = loadKit(root).version, to = nextVersion(from, "minor");

  const none = release(); assert.equal(none.status, 1); assert.match(none.stderr, /nothing to release: changes\/ holds no fragment/);
  write(root, "changes/small-fix.md", "bump: patch\n\n- A fix.\n\nBy hand: nothing. A remark.\n");
  write(root, "changes/new-thing.md", "bump: minor\n\n- A new thing.\n- Its second line.\n\nBy hand: add the line\nto the skeleton.\n");
  const uncommitted = release(); assert.equal(uncommitted.status, 1, output(uncommitted));
  assert.match(uncommitted.stderr, /uncommitted changes/, "a fragment never committed stays out of a release");
  git("add", "-A"); git("commit", "-qm", "two fragments");

  const dry = release("--dry-run"); assert.equal(dry.status, 0, output(dry));
  assert.ok(dry.stdout.includes(`${from} → ${to} (minor)`), dry.stdout);
  assert.equal(git("status", "--porcelain"), "", "--dry-run writes nothing");

  const done = release(); assert.equal(done.status, 0, output(done));
  assert.deepEqual(git("status", "--porcelain").trimEnd().split("\n").sort(), [" D changes/new-thing.md", " D changes/small-fix.md", " M .claude/harness.json", " M CHANGELOG.md", " M kit.json", " M package.json"], "what a release writes, and nothing else");
  assert.equal(loadKit(root).version, to);
  versionsAgree(root);
  assert.ok(read(root, "CHANGELOG.md").includes(`\n\n## ${to}\n\n- A new thing.\n- Its second line.\n- A fix.\n\nBy hand: add the line\nto the skeleton.\n\nA remark.\n\n## ${from}\n`), "the higher level first, one list, one By hand part, above the previous entry");
  assert.equal(changelogEntries(root)[0].byHand, "By hand: add the line\nto the skeleton.\n\nA remark.", "the step `update` will list for the version");
  const check = run(root, process.execPath, [path.join(root, "bin/harness.mjs"), "update", ".", "--check"], { input: "" });
  assert.equal(check.status, 0, output(check));
  assert.match(release().stderr, /nothing to release/, "the fragments are spent");
});

// The CI check of the kit's own pull requests (.github/workflows/ci.yml): one that changes modules/, lib/ or bin/
// adds a changelog fragment. The step's script runs here as on the runner, on the merge commit of a pull request
// whose first parent is the base — the allows, and the nearby forms that must stay red.
test("CI: a pull request that changes modules/, lib/ or bin/ adds a changelog fragment under changes/", () => {
  const step = /\n      - name: Changelog fragment[^\n]*\n(?: {8}(?!run: \|)[^\n]*\n)* {8}run: \|\n((?: {10}[^\n]*\n|\n)+)/.exec(read(KIT_ROOT, ".github/workflows/ci.yml"));
  assert.ok(step, "the step is in ci.yml");
  const script = step[1].replace(/^ {10}/gm, "");
  assert.doesNotMatch(script, /\$\{\{/, "no expression in the script");
  const pr = (change, mainMoves) => {
    const dir = tmp("harness-ci-fragment-");
    const git = (...args) => { const r = run(dir, "git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args]); assert.equal(r.status, 0, output(r)); };
    write(dir, "lib/a.mjs", "a\n"); write(dir, "docs/a.md", "a\n"); write(dir, "changes/waiting.md", "a\n");
    git("init", "-q", "-b", "main"); git("add", "-A"); git("commit", "-qm", "base");
    git("checkout", "-qb", "topic"); change(dir); git("add", "-A"); git("commit", "-qm", "the pull request");
    git("checkout", "-q", "main");
    if (mainMoves) { mainMoves(dir); git("add", "-A"); git("commit", "-qm", "main moves"); }
    git("merge", "-q", "--no-ff", "-m", "merge", "topic"); // as GitHub builds it: the base first, the pull request second
    return run(dir, "bash", ["-c", script]);
  };
  const cases = [
    ["lib/ and a new fragment", 0, (d) => { write(d, "lib/a.mjs", "b\n"); write(d, "changes/a-fix.md", "x\n"); }],
    ["a new module and a new fragment", 0, (d) => { write(d, "modules/x/module.json", "{}\n"); write(d, "changes/x.md", "x\n"); }],
    ["documentation only", 0, (d) => write(d, "docs/a.md", "b\n")],
    ["a fragment only", 0, (d) => write(d, "changes/note.md", "x\n")],
    ["lib/ without a fragment", 1, (d) => write(d, "lib/a.mjs", "b\n")],
    ["bin/ without a fragment", 1, (d) => write(d, "bin/new.mjs", "x\n")],
    ["a file of lib/ deleted, no fragment", 1, (d) => fs.unlinkSync(path.join(d, "lib/a.mjs"))],
    ["lib/ and an edit of a fragment already waiting", 1, (d) => { write(d, "lib/a.mjs", "b\n"); write(d, "changes/waiting.md", "b\n"); }],
    ["lib/, while main gains a fragment of its own", 1, (d) => write(d, "lib/a.mjs", "b\n"), (d) => write(d, "changes/other.md", "x\n")],
  ];
  for (const [what, status, change, mainMoves] of cases) {
    const r = pr(change, mainMoves);
    assert.equal(r.status, status, `${what}:\n${output(r)}`);
    if (status) assert.match(r.stdout, /^::error::This pull request changes modules\/, lib\/ or bin\/ and adds no changelog fragment/m, what);
  }
  assert.match(pr((d) => write(d, "lib/::warning::x.mjs", "x\n")).stdout, /^ {2}lib\/::warning::x\.mjs$/m, "a file name is printed indented, never where the runner reads a command");
  const single = tmp("harness-ci-fragment-");
  write(single, "a.txt", "a\n");
  for (const args of [["init", "-q", "-b", "main"], ["add", "-A"], ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "one"]]) assert.equal(run(single, "git", args).status, 0);
  const lone = run(single, "bash", ["-c", script]);
  assert.equal(lone.status, 1); assert.match(lone.stdout, /::error::HEAD is not the merge commit of a pull request/, "anything but a merge commit is refused, not passed");
});

// The kit's CI runs on every pull request and skips its test job when nothing the tests read changed
// (.github/workflows/ci.yml, job `changes`). The step's script runs here as on the runner, on a table of changes: 'false'
// only for documentation the tests do not read, from a diff it could read; 'true' for anything else, including what
// it cannot tell (another event, a push of several commits, no merge commit).
test("CI: the changes job skips the tests only for documentation they do not read, and fails closed", () => {
  const step = /\n      - name: Anything the tests read\?\n(?: {8}(?!run: \|)[^\n]*\n)* {8}run: \|\n((?: {10}[^\n]*\n|\n)+)/.exec(read(KIT_ROOT, ".github/workflows/ci.yml"));
  assert.ok(step, "the step is in ci.yml");
  const script = step[1].replace(/^ {10}/gm, "");
  assert.doesNotMatch(script, /\$\{\{/, "no expression in the script");
  const verdict = (event, build) => {
    const dir = tmp("harness-ci-changes-"), out = path.join(dir, "..", `${path.basename(dir)}.out`);
    const git = (...args) => { const r = run(dir, "git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args]); assert.equal(r.status, 0, output(r)); return r.stdout.trim(); };
    write(dir, "lib/a.mjs", "a\n"); write(dir, "docs/a.md", "a\n"); write(dir, "README.md", "a\n"); write(dir, "modules/x/files/docs/x.md", "a\n");
    git("init", "-q", "-b", "main"); git("add", "-A"); git("commit", "-qm", "base");
    const before = build(dir, git) ?? "";
    fs.writeFileSync(out, "");
    const r = spawnSync("bash", ["-e", "-c", script], { cwd: dir, encoding: "utf8", env: { ...ENV, EVENT: event, BEFORE: before, GITHUB_OUTPUT: out } });
    assert.equal(r.status, 0, output(r));
    const lines = fs.readFileSync(out, "utf8").split("\n").filter((l) => l.startsWith("code="));
    assert.equal(lines.length, 1, "one code= line");
    return lines[0];
  };
  const pr = (change) => (d, git) => { git("checkout", "-qb", "topic"); change(d); git("add", "-A"); git("commit", "-q", "--allow-empty", "-m", "pr"); git("checkout", "-q", "main"); git("commit", "-q", "--allow-empty", "-m", "main moves"); git("merge", "-q", "--no-ff", "-m", "merge", "topic"); };
  const pushOne = (change) => (d, git) => { const before = git("rev-parse", "HEAD"); change(d); git("add", "-A"); git("commit", "-qm", "push"); return before; };
  const cases = [
    ["documentation", "false", "pull_request", pr((d) => write(d, "docs/a.md", "b\n"))],
    ["a Markdown file elsewhere", "false", "pull_request", pr((d) => write(d, "notes/x.md", "b\n"))],
    ["documentation, pushed in one commit", "false", "push", pushOne((d) => write(d, "docs/a.md", "b\n"))],
    ["code", "true", "pull_request", pr((d) => write(d, "lib/a.mjs", "b\n"))],
    ["README.md, which the tests read", "true", "pull_request", pr((d) => write(d, "README.md", "b\n"))],
    ["a convention page the kit installs at its root", "true", "pull_request", pr((d) => write(d, "docs/conventions/local-gate.md", "b\n"))],
    ["the findings catalogue at the root", "true", "pull_request", pr((d) => write(d, "SECURITY_REVIEW.md", "b\n"))],
    ["a Markdown file a module ships", "true", "pull_request", pr((d) => write(d, "modules/x/files/docs/x.md", "b\n"))],
    ["a changelog fragment", "true", "pull_request", pr((d) => write(d, "changes/x.md", "b\n"))],
    ["CLAUDE.md, which the gate checks", "true", "pull_request", pr((d) => write(d, "CLAUDE.md", "b\n"))],
    ["an agent definition", "true", "pull_request", pr((d) => write(d, ".claude/agents/x.md", "b\n"))],
    ["code moved into docs/", "true", "pull_request", pr((d) => fs.renameSync(path.join(d, "lib/a.mjs"), path.join(d, "docs/a.mjs.md")))],
    ["nothing", "true", "pull_request", pr(() => {})],
    ["no merge commit", "true", "pull_request", (d, git) => { write(d, "docs/a.md", "b\n"); git("commit", "-qam", "one"); }],
    ["a push of two commits", "true", "push", (d, git) => { const before = git("rev-parse", "HEAD"); write(d, "docs/a.md", "b\n"); git("commit", "-qam", "one"); write(d, "docs/a.md", "c\n"); git("commit", "-qam", "two"); return before; }],
    ["a push with no previous tip", "true", "push", (d, git) => { write(d, "docs/a.md", "b\n"); git("commit", "-qam", "one"); }],
    ["a scheduled run", "true", "schedule", pr((d) => write(d, "docs/a.md", "b\n"))],
  ];
  for (const [what, code, event, build] of cases) assert.equal(verdict(event, build), `code=${code}`, what);
});

// The kit's CI holds its jobs while a session is still at work on a pull request — a draft labelled session-active.
// Every job, or a held run ends `success` with the tests skipped, and ready-on-green could lift the draft on it if the
// label came off before it read the pull request; a run whose jobs all skip ends `skipped`, which it does not act on.
// The label coming off (`unlabeled`) or the draft lifted by hand (`ready_for_review`) runs the jobs in full.
test("CI: every job is held while a draft is labelled session-active, and runs once the label comes off", () => {
  const ci = read(KIT_ROOT, ".github/workflows/ci.yml");
  const types = /\n {2}pull_request:\n(?: {4}[^\n]*\n)*? {4}types: \[([^\]\n]*)\]\n/.exec(ci);
  assert.ok(types, "the pull_request trigger lists its types on one line");
  const listed = types[1].split(",").map((t) => t.trim());
  for (const t of ["opened", "synchronize", "reopened", "unlabeled", "ready_for_review"]) assert.ok(listed.includes(t), `the pull_request types include ${t}`);
  const held = "!(github.event.pull_request.draft && contains(github.event.pull_request.labels.*.name, 'session-active'))";
  const hold = `    if: \${{ ${held} }}`;
  const jobs = ci.slice(ci.indexOf("\njobs:\n") + 1).split(/\n(?= {2}[A-Za-z0-9_-]+:\n)/).slice(1);
  assert.ok(jobs.length >= 3, "the jobs are read");
  for (const job of jobs) {
    const name = /^ {2}([A-Za-z0-9_-]+):/.exec(job)[1];
    // The test job also waits for the changes verdict; the security job and the changes job carry the hold alone.
    const expected = name === "test" ? `    if: \${{ ${held} && needs.changes.outputs.code != 'false' }}` : hold;
    assert.deepEqual(job.split("\n").filter((l) => /^ {4}if:/.test(l)), [expected], `job ${name} carries the hold, as written, and no other condition`);
  }
  assert.doesNotMatch(ci.slice(0, ci.indexOf("\njobs:\n")), /\bpaths(-ignore)?:/, "no path filter: every pull request gets a run, so its required checks report");
});

// Seeds never follow the kit: what a version asks to report by hand is in the changelog, and `update` shows it.
test("update lists the By hand steps of the versions it crosses, until the manifest names the new one", () => {
  const root = kitCopy(), dir = tmp();
  for (const rel of ["bin", "lib"]) fs.cpSync(path.join(KIT_ROOT, rel), path.join(root, rel), { recursive: true });
  const version = (v) => fs.writeFileSync(path.join(root, "kit.json"), JSON.stringify({ name: "claude-template", version: v, repository: "example/kit" }));
  version("1.0.0");
  applyPlan(buildPlan({ kit: loadKit(root), target: dir, given: { PROJECT_NAME: "demo-app" } }));
  version("1.2.0");
  write(root, "CHANGELOG.md", "# Changelog\n\n## 1.3.0\n\nNot there yet.\n\nBy hand: a step of the future.\n\n## 1.2.0\n\n- A thing.\n\nBy hand, for an installed project: add the new line\nto the skeleton.\n\n## 1.1.0\n\nBy hand: nothing. To take the new module: add it.\n\n## 1.0.0\n\nBy hand: an old step.\n");
  write(path.join(root, "modules/core/files"), "docs/conventions/new-page.md", "# New\n");
  const up = (...args) => spawnSync(process.execPath, [path.join(root, "bin/harness.mjs"), "update", dir, ...args], { encoding: "utf8", input: "" });
  const check = up("--check"); assert.equal(check.status, 3, output(check));
  assert.match(check.stdout, /BY HAND[^\n]*\(1 version\(s\) crossed[^\n]*\n  1\.2\.0  By hand, for an installed project: add the new line\n +to the skeleton\./);
  assert.doesNotMatch(check.stdout, /old step|of the future|1\.1\.0/, "only the versions after the recorded one, up to the kit's, and only those with a step — a remark after \"nothing.\" is not one");
  assert.match(check.stdout, /behind the kit: 1 item/, "a step is not counted as behind");
  assert.match(up().stdout, /BY HAND/, "shown by the update that crosses the version");
  const after = up("--check"); assert.equal(after.status, 0); assert.doesNotMatch(after.stdout, /BY HAND/, "and not once the manifest names it");
  assert.deepEqual(byHandBetween(kitCopy(), "1.0.0", "9.9.9"), [], "a kit without a changelog has no step to show");
});

// A version that changed nothing a project installs still moves the manifest: until `update` writes it, the
// project is behind, and --check says so rather than exit 0 under a "kit X → Y" line.
test("update --check exits 3 when only the kit version the manifest records is behind", () => {
  const root = kitCopy(), dir = tmp();
  for (const rel of ["bin", "lib"]) fs.cpSync(path.join(KIT_ROOT, rel), path.join(root, rel), { recursive: true });
  const version = (v) => fs.writeFileSync(path.join(root, "kit.json"), JSON.stringify({ name: "claude-template", version: v, repository: "example/kit" }));
  version("1.0.0");
  applyPlan(buildPlan({ kit: loadKit(root), target: dir, given: { PROJECT_NAME: "demo-app" } }));
  version("1.0.1");
  const up = (...args) => spawnSync(process.execPath, [path.join(root, "bin/harness.mjs"), "update", dir, ...args], { encoding: "utf8", input: "" });
  const before = readManifest(dir);
  const check = up("--check"); assert.equal(check.status, 3, output(check));
  assert.match(check.stdout, /kit 1\.0\.0 → 1\.0\.1/);
  assert.match(check.stdout, /behind the kit: only the version the manifest records \(1\.0\.0\); `update` writes 1\.0\.1/);
  assert.deepEqual(readManifest(dir), before, "--check writes nothing");
  assert.equal(up("--check", "--modules", "core").status, 0, "a selection never writes the version: in step");
  assert.equal(up("--check", "--only", "scripts/").status, 0);
  const done = up(); assert.equal(done.status, 0, output(done));
  assert.equal(readManifest(dir).kit.version, "1.0.1");
  const after = up("--check"); assert.equal(after.status, 0, output(after)); assert.doesNotMatch(after.stdout, /behind the kit/);
});

// `status . | head`: the reader closes, the command is not at fault.
test("a reader that closes early stops the report, not the command", async () => {
  const dir = tmp(); install(dir, []);
  const closed = (...args) => new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let err = ""; child.stderr.on("data", (d) => { err += d; });
    child.stdout.destroy();
    child.on("close", (code) => resolve({ code, err }));
  });
  const st = await closed("status", dir); assert.equal(st.code, 0, st.err); assert.equal(st.err, "", "no stack trace");
  fs.rmSync(path.join(dir, "scripts/security-checks.sh"));
  const up = await closed("update", dir); assert.equal(up.code, 0, up.err); assert.equal(up.err, "");
  assert.ok(fs.existsSync(path.join(dir, "scripts/security-checks.sh")), "the files are written all the same");
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

// OS-1 on a CI runner: without the CLI the guard installs the version its lockfile pins, outside the project, and a
// runner that cannot install it is red, never skipped. npm and the CLI are stand-ins here: the suite needs no network.
test("openspec: on a runner OS-1 installs the pinned CLI, and fails where a laptop skips", (t) => {
  if (!kit.modules.has("openspec")) return;
  const dir = tmp(), bin = path.join(tmp(), "bin"), log = path.join(tmp(), "log");
  install(dir, ["openspec"]);
  const pin = "scripts/guards.d/46-openspec";
  const lock = JSON.parse(read(dir, `${pin}/package-lock.json`)), manifest = JSON.parse(read(dir, `${pin}/package.json`));
  const version = manifest.dependencies["@fission-ai/openspec"];
  assert.match(version, /^\d+\.\d+\.\d+$/, "the CLI is pinned to an exact version");
  assert.equal(lock.packages["node_modules/@fission-ai/openspec"].version, version, "the lockfile is the one of that version");
  const packages = Object.entries(lock.packages).filter(([name]) => name);
  assert.ok(packages.length > 20, "the lockfile lists the CLI's dependencies");
  for (const [name, p] of packages) {
    assert.match(name, /^node_modules\//, `${name}: installed under node_modules`);
    assert.match(p.integrity ?? "", /^sha512-/, `${name}: an integrity hash`);
    assert.match(p.resolved ?? "", /^https:\/\/registry\.npmjs\.org\//, `${name}: from the npm registry`);
    assert.ok(!p.hasInstallScript, `${name}: no install script`);
  }

  // The guard's PATH is a directory of links to the few commands it uses: neither openspec nor npm is there until a
  // stand-in is written, wherever this machine keeps its own.
  const env = (extra) => ({ ...ENV, PATH: bin, CI: "", HARNESS_OFFLINE: "", NODE_TEST_CONTEXT: "", LOG: log, ...extra });
  const guard = (extra) => run(dir, "bash", ["scripts/guards.d/46-openspec.sh"], { env: env(extra) });
  fs.mkdirSync(bin);
  const missing = linkTools(bin, ["bash", "dirname", "find", "head", "tail", "mktemp", "cp", "rm", "mkdir", "chmod"]);
  if (noWorkingRm(t, missing)) return;
  assert.deepEqual(missing, [], "the commands the guard uses are on this machine");
  assert.equal(guard().status, 77, "nothing to validate yet: skipped");
  assert.equal(guard({ CI: "true" }).status, 77, "nothing to validate yet: skipped on a runner too");
  write(dir, "openspec/changes/demo/proposal.md", "# Demo\n");

  assert.equal(guard().status, 77, "a laptop without the CLI skips");
  let r = guard({ CI: "true" });
  assert.equal(r.status, 1, output(r)); assert.match(output(r), /OS-1: .*npm is not there.* mandatory on a CI runner/);

  write(bin, "npm", '#!/usr/bin/env bash\nprintf \'%s\\n\' "$*" > "$LOG.npm"; pwd -P > "$LOG.cwd"; cp package.json package-lock.json "$LOG.d/" || exit 3\n[ -z "${NPM_FAILS:-}" ] || { echo "npm error EINTEGRITY" >&2; exit 1; }\n[ -z "${NPM_EMPTY:-}" ] || exit 0\nmkdir -p node_modules/.bin\nprintf \'%s\\n\' \'#!/usr/bin/env bash\' \'printf "%s\\n" "telemetry=$OPENSPEC_TELEMETRY" "$*" "$PWD" > "$LOG.openspec"\' \'[ -z "${INVALID:-}" ] || { echo "change demo: no deltas"; exit 1; }\' > node_modules/.bin/openspec\nchmod +x node_modules/.bin/openspec\n', 0o755);
  fs.mkdirSync(`${log}.d`);
  r = guard({ CI: "true" });
  assert.equal(r.status, 0, output(r)); assert.match(r.stdout, /OS-1: openspec validate passes/);
  assert.equal(read(`${log}.npm`, "").trim(), "ci --ignore-scripts --no-audit --no-fund", "the lockfile is installed as it is, and no package script runs");
  const where = read(`${log}.cwd`, "").trim();
  assert.ok(!where.startsWith(fs.realpathSync(dir)), "the CLI is installed outside the project");
  assert.ok(!fs.existsSync(where), "and its directory is removed afterwards");
  for (const f of ["package.json", "package-lock.json"]) assert.equal(read(`${log}.d`, f), read(dir, `${pin}/${f}`), `${f} is the module's`);
  assert.deepEqual(read(`${log}.openspec`, "").trim().split("\n"), ["telemetry=0", "validate --all --strict --no-interactive", fs.realpathSync(dir)], "the pinned CLI validates the project, telemetry off");
  assert.deepEqual(walk(dir).filter((f) => f.includes("node_modules")), [], "nothing is installed in the project");

  r = guard({ CI: "true", INVALID: "1" });
  assert.equal(r.status, 1, output(r)); assert.match(output(r), /change demo: no deltas[\s\S]*OS-1: openspec validate --all --strict fails/);
  r = guard({ CI: "true", NPM_FAILS: "1" });
  assert.equal(r.status, 1, output(r)); assert.match(output(r), /EINTEGRITY[\s\S]*OS-1: npm ci could not install the pinned CLI.* mandatory on a CI runner/);
  r = guard({ CI: "true", NPM_EMPTY: "1" });
  assert.equal(r.status, 1, output(r)); assert.match(output(r), /OS-1: npm ci left no openspec command/);
  // Offline — the push hook, on a runner too — nothing can be installed: skipped, and npm is not called.
  fs.rmSync(`${log}.npm`);
  r = guard({ CI: "true", HARNESS_OFFLINE: "true" });
  assert.equal(r.status, 77, output(r)); assert.match(output(r), /OS-1: .*needs the network/);
  assert.ok(!fs.existsSync(`${log}.npm`), "offline, npm is not called");
  fs.writeFileSync(`${log}.npm`, "");
  fs.renameSync(path.join(dir, pin, "package-lock.json"), path.join(dir, pin, "moved"));
  r = guard({ CI: "true" });
  assert.equal(r.status, 1, output(r)); assert.match(output(r), /OS-1: .*its pin .* is missing.* mandatory on a CI runner/);
  fs.renameSync(path.join(dir, pin, "moved"), path.join(dir, pin, "package-lock.json"));

  // A CLI on the PATH is the one used, on a runner as on a laptop: npm is not called.
  fs.rmSync(`${log}.npm`);
  write(bin, "openspec", '#!/usr/bin/env bash\nprintf \'%s\\n\' "path $*" > "$LOG.openspec"\n', 0o755);
  for (const CI of ["", "true"]) { r = guard({ CI }); assert.equal(r.status, 0, output(r)); }
  assert.equal(read(`${log}.openspec`, "").trim(), "path validate --all --strict --no-interactive");
  assert.ok(!fs.existsSync(`${log}.npm`), "npm was not called");
});

test("the gate: a failing guard fails it, a skipped one does not, an empty one is an error", () => {
  const dir = tmp();
  install(dir, []);
  // A self-test run with `node --test` that fails must fail the gate, also when the gate is started from a Node test
  // run (gate() sets NODE_TEST_CONTEXT as one does), and a guard started on its own from one.
  write(dir, "scripts/red.test.mjs", 'import { test } from "node:test";\nimport assert from "node:assert/strict";\ntest("red", () => assert.equal(1, 2));\n');
  write(dir, "scripts/guards.d/96-self-test.sh", '#!/usr/bin/env bash\n. "$(dirname "$0")/_lib.sh"\nif node --test scripts/red.test.mjs >/dev/null 2>&1; then ok "self-test"; else fail "self-test"; fi\nfinish\n', 0o755);
  let nested = gate(dir); assert.equal(nested.status, 1, "a nested test run reports its failures"); assert.match(nested.stderr, /FAILED: 96-self-test/);
  for (const context of ["child-v8", "child"]) assert.equal(run(dir, "bash", ["scripts/guards.d/96-self-test.sh"], { env: { ...ENV, NODE_TEST_CONTEXT: context } }).status, 1, `a guard started on its own, NODE_TEST_CONTEXT=${context}`);
  // A project's guard need not source _lib.sh: the gate clears the variable for it too.
  write(dir, "scripts/guards.d/96-self-test.sh", "#!/usr/bin/env bash\nnode --test scripts/red.test.mjs >/dev/null 2>&1\n", 0o755);
  nested = gate(dir); assert.equal(nested.status, 1, "a guard without _lib.sh"); assert.match(nested.stderr, /FAILED: 96-self-test/);
  // Without NODE_TEST_CONTEXT nothing stops a guard that starts the gate again, but the gate itself: three levels.
  write(dir, "scripts/guards.d/96-self-test.sh", "#!/usr/bin/env bash\nbash scripts/security-checks.sh --offline >/dev/null\n", 0o755);
  nested = gate(dir); assert.equal(nested.status, 1, "a gate that starts itself again stops"); assert.match(nested.stderr, /started from inside its own guards 3 times/);
  fs.rmSync(path.join(dir, "scripts/guards.d/96-self-test.sh"));
  const odd = run(dir, "bash", ["scripts/security-checks.sh", "--offline"], { env: { ...ENV, CI: "", HARNESS_GATE_DEPTH: "x$(touch PWNED)" } });
  assert.equal(odd.status, 0, `an unreadable depth counts as none:\n${output(odd)}`);
  assert.ok(!fs.existsSync(path.join(dir, "PWNED")), "the depth is never evaluated");
  assert.equal(run(dir, "bash", ["scripts/security-checks.sh", "--offline"], { env: { ...ENV, CI: "", HARNESS_GATE_DEPTH: "3" } }).status, 1, "a fourth level is refused");
  write(dir, "scripts/guards.d/97-skipped.sh", "#!/usr/bin/env bash\nexit 77\n", 0o755);
  let r = gate(dir); assert.equal(r.status, 0, output(r)); assert.match(r.stdout, /skipped: (12-review-record )?97-skipped/);
  write(dir, "scripts/guards.d/98-broken.sh", "#!/usr/bin/env bash\nexit 1\n", 0o755);
  r = gate(dir); assert.equal(r.status, 1); assert.match(r.stderr, /FAILED: 98-broken/);
  assert.equal(gate(dir, "--everything").status, 2, "an unknown flag is a usage error, not a pass");
  for (const f of fs.readdirSync(path.join(dir, "scripts/guards.d"))) if (/^\d\d-/.test(f)) fs.rmSync(path.join(dir, "scripts/guards.d", f));
  r = gate(dir); assert.equal(r.status, 1); assert.match(r.stderr, /checked nothing/);
});

// A conflict committed as text — a rebase stopped, then the file staged and the rebase continued — passes every
// other guard. CF-1 refuses a marker at the start of a line; a heading underlined with `=======` and a marker
// shown indented stay green.
test("CF-1: a tracked file that holds a git conflict marker turns the gate red", () => {
  const dir = tmp();
  install(dir, []);
  const marker = (c) => c.repeat(7); // built here so that this file holds no marker at the start of a line
  const [open, base, sep, close] = [marker("<"), marker("|"), marker("="), marker(">")];
  for (const [text, why] of [
    [`a\n${open} HEAD\nours\n${sep}\ntheirs\n${close} topic\n`, "a two-way conflict"],
    [`a\n${open} HEAD\nours\n${base} parent of 1234567 (x)\nbase\n${sep}\ntheirs\n${close} 1234567 (x)\n`, "a diff3 conflict"],
    [`${open}\n`, "a marker alone on its line"],
    ["```\n" + `${close} topic\n` + "```\n", "a marker at column 0 inside a fenced block"],
  ]) {
    write(dir, "docs/page.md", text);
    const r = gate(dir); assert.equal(r.status, 1, `${why} is refused`); assert.match(r.stderr, /CF-1: \d+ line\(s\) start with a git conflict marker/);
    assert.match(r.stderr, /docs\/page\.md:2|docs\/page\.md:1/, "the file and the line are named");
  }
  for (const [text, why] of [
    [`Title\n${sep}\n\nText.\n`, "a heading underlined with seven `=`"],
    ["```\n" + `    ${open} HEAD\n    ${close} topic\n` + "```\n", "an indented example"],
    [`${open}${open}\n> quoted ${close}\n`, "a longer run, and a marker that does not start its line"],
  ]) {
    write(dir, "docs/page.md", text);
    const r = gate(dir); assert.equal(r.status, 0, `${why} passes: ${output(r)}`);
  }
  fs.writeFileSync(path.join(dir, "docs/blob.bin"), Buffer.from(`\0${open} HEAD\n`));
  assert.equal(gate(dir).status, 0, "a binary file is not read");
});

test("CM-1 and CM-2: the budget and the pointers of CLAUDE.md are enforced", () => {
  const dir = tmp();
  install(dir, []);
  const original = read(dir, "CLAUDE.md");
  write(dir, "CLAUDE.md", `${original}\n${"x".repeat(26000)}\n`);
  let r = gate(dir); assert.equal(r.status, 1); assert.match(r.stderr, /CM-1: CLAUDE\.md loads \d+ bytes into a session \([^)]*\), over its budget of 25000/);
  // A block-level comment costs no context, so no budget; the same text inline, indented, in a code fence or left open does.
  const pad = "x".repeat(26000);
  for (const [hiddenForm, why] of [[`<!-- ${pad} -->`, "one line"], [`<!--\n${pad}\n-->`, "several lines"]]) {
    write(dir, "CLAUDE.md", `${original}\n${hiddenForm}\n`);
    assert.equal(gate(dir).status, 0, `a block-level comment (${why}) is not counted`);
  }
  for (const [counted, why] of [[`text <!-- ${pad} -->`, "inline"], [`   <!-- ${pad} -->`, "indented"], [`<!-- ${pad} --> text`, "followed by text"], [`<!-- ${pad}`, "never closed"], ["```\n<!-- " + pad + " -->\n```", "in a code fence"], ["~~~\n```\n<!-- " + pad + " -->\n~~~", "in a fence that holds another fence marker"]]) {
    write(dir, "CLAUDE.md", `${original}\n${counted}\n`);
    r = gate(dir); assert.equal(r.status, 1, `a comment ${why} is counted`); assert.match(r.stderr, /CM-1: CLAUDE\.md loads/);
  }
  // A rule file without `paths:` is loaded at launch: it counts. Scoped, it does not.
  write(dir, "CLAUDE.md", original);
  write(dir, ".claude/rules/big.md", `# Big\n\n${pad}\n`);
  r = gate(dir); assert.equal(r.status, 1, "an unscoped rule counts against the budget"); assert.match(r.stderr, /26\d\d\d in unscoped \.claude\/rules/);
  write(dir, ".claude/rules/big.md", `---\ndescription: x\n---\n\n${pad}\n`);
  assert.equal(gate(dir).status, 1, "a frontmatter without paths: is still unscoped");
  write(dir, ".claude/rules/big.md", `---\npaths:\n  - "src/**"\n---\n\n${pad}\n`);
  assert.equal(gate(dir).status, 0, "a path-scoped rule is loaded on demand: not counted");
  fs.rmSync(path.join(dir, ".claude/rules"), { recursive: true });
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

// The kit installs part of itself at its root, so that its guards and workflows run somewhere. Those copies are
// installed files: a module changed without `node bin/harness.mjs update .` leaves the root running the old one.
test("the kit's own installation is what the modules ship today", () => {
  if (!readManifest(KIT_ROOT)) return; // a copy of the kit without its own harness
  const s = summarize(buildPlan({ kit, target: KIT_ROOT, mode: "update" }));
  const fix = "run `node bin/harness.mjs update .` at the root of the kit";
  assert.deepEqual([s.created, s.updated, s.outdated, s.dropped], [[], [], [], []], `a root copy is behind its module: ${fix}`);
  assert.deepEqual(s.conflicts, [], `a root file was edited in place: ${fix} --force`);
  assert.deepEqual(s.local, [], "no kit file is edited at the root: change the module instead");
  assert.deepEqual(s.fragmentsMissingSlot, []);
});

// README.md and CLAUDE.md name the modules installed at the kit's root, in one sentence each. Nothing else ties
// them to the manifest: a module added at the root without both sentences would go unnoticed.
test("README.md and CLAUDE.md name exactly the modules installed at the kit's root", () => {
  const manifest = readManifest(KIT_ROOT);
  if (!manifest) return; // a copy of the kit without its own harness
  const installed = [...manifest.modules].sort();
  const named = (file, re) => {
    const list = re.exec(read(KIT_ROOT, file))?.[1];
    assert.ok(list, `${file}: the sentence that lists the modules installed at the root is not found`);
    return [...list.matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1]).sort();
  };
  assert.deepEqual(named("README.md", /The kit installs part of itself at its root — ([^\n]*?) — /), installed, "README.md § Working on the kit");
  assert.deepEqual(named("CLAUDE.md", /The kit installs part of itself at its root \(`\.claude\/harness\.json`\): ([^\n]*?), so that /), installed, "CLAUDE.md § The kit's own harness");
});

test("session-settings: the gate goes red when the settings file widens what every session may do", () => {
  if (!kit.modules.has("session-settings")) return;
  const dir = tmp();
  install(dir, ["session-settings"]);
  const file = ".claude/settings.json";
  const shipped = JSON.parse(read(dir, file));
  assert.equal(gate(dir).status, 0);
  const red = (label, change, id) => {
    const s = structuredClone(shipped);
    change(s);
    write(dir, file, `${JSON.stringify(s, null, 2)}\n`);
    const r = gate(dir);
    assert.equal(r.status, 1, `${label}: the gate must fail\n${output(r)}`);
    assert.match(r.stderr, new RegExp(`FAIL\\s+${id}:`), label);
  };
  red("the .env rule removed", (s) => { s.permissions.deny = s.permissions.deny.filter((r) => r !== "Read(.env)"); }, "SS-1");
  red(".env itself carved out", (s) => { s.permissions.deny.push("Read(!.env)"); }, "SS-1");
  red("a wildcard carve-out", (s) => { s.permissions.deny.push("Read(!.env.*)"); }, "SS-1");
  red("bypass mode", (s) => { s.permissions.defaultMode = "bypassPermissions"; }, "SS-2");
  red("all of Bash allowed", (s) => { s.permissions.allow = ["Bash(*)"]; }, "SS-2");
  red("every project MCP server approved", (s) => { s.enableAllProjectMcpServers = true; }, "SS-2");
  red("hooks disabled", (s) => { s.disableAllHooks = true; }, "SS-2");
  write(dir, file, "{ not json\n");
  assert.match(gate(dir).stderr, /FAIL\s+SS-1: [^\n]*not valid JSON/);
  // What a project may decide stays green, and is said.
  const relaxed = structuredClone(shipped);
  relaxed.permissions.allow = ["Bash(npm test)"];
  delete relaxed.sandbox;
  write(dir, file, `${JSON.stringify(relaxed, null, 2)}\n`);
  const r = gate(dir);
  assert.equal(r.status, 0, output(r));
  assert.match(r.stdout, /note\s+SS-2: the Bash sandbox is not enabled/);
  // A personal settings file in git applies to everyone.
  write(dir, file, `${JSON.stringify(shipped, null, 2)}\n`);
  write(dir, ".claude/settings.local.json", "{}\n");
  assert.equal(run(dir, "git", ["add", "-f", ".claude/settings.local.json"]).status, 0);
  assert.match(run(dir, "bash", ["scripts/security-checks.sh", "--offline"], { env: { ...ENV, CI: "" } }).stderr, /FAIL\s+SS-3:/);
});

test("parallel-sessions: PS-1 goes red when session worktrees are no longer ignored, or one is tracked", () => {
  if (!kit.modules.has("parallel-sessions")) return;
  const dir = tmp();
  install(dir, ["parallel-sessions"]);
  const r = gate(dir);
  assert.equal(r.status, 0, output(r));
  assert.match(r.stdout, /ok\s+PS-1: /);
  assert.doesNotMatch(output(r), /PS-2/, "before the first commit there is nothing to compare, and nothing is said");
  const ignore = read(dir, ".gitignore");
  write(dir, ".gitignore", `${ignore}!.claude/worktrees/\n`);
  assert.match(gate(dir).stderr, /FAIL\s+PS-1: \.claude\/worktrees\/ is not ignored/);
  write(dir, ".gitignore", ignore);
  assert.equal(gate(dir).status, 0);
  write(dir, ".claude/worktrees/w/file", "x\n");
  assert.equal(run(dir, "git", ["add", "-f", ".claude/worktrees/w/file"]).status, 0);
  const tracked = gate(dir);
  assert.equal(tracked.status, 1, output(tracked));
  assert.match(tracked.stderr, /FAIL\s+PS-1: git tracks paths under \.claude\/worktrees\//);
});

// The report reads refs, which every worktree shares, so all it says can be staged in a scratch repository:
// a bare "origin", a main checkout, and worktrees where Claude Code puts them. Git runs without the user's
// configuration: a signing key or a hook path of the machine has no say in what the report prints.
test("parallel-sessions: the report names a stale base, the files two branches share and a merge that conflicts", () => {
  if (!kit.modules.has("parallel-sessions")) return;
  const root = tmp(), origin = path.join(root, "origin.git"), dir = path.join(root, "proj");
  const env = { ...ENV, CI: "", GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid" };
  const git = (cwd, ...args) => { const r = run(cwd, "git", ["-c", "commit.gpgsign=false", ...args], { env }); assert.equal(r.status, 0, `git ${args.join(" ")}\n${output(r)}`); return r.stdout; };
  const report = (cwd, ...args) => run(cwd, "bash", ["scripts/parallel-sessions.sh", ...args], { env });
  const wt = (name) => path.join(dir, ".claude/worktrees", name);
  fs.mkdirSync(dir);
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  install(dir, ["parallel-sessions"]);
  git(dir, "init", "-q", "-b", "main");
  write(dir, "base.txt", "a\nb\nc\n"); write(dir, "shared.txt", "1\n2\n3\n"); write(dir, "landed.txt", "x\n");
  git(dir, "add", "-A"); git(dir, "commit", "-qm", "init");
  git(dir, "remote", "add", "origin", origin); git(dir, "push", "-q", "origin", "main");
  // A branch name may hold what a shell would run: it is printed, never evaluated.
  const hostile = "x;touch${IFS}PWNED$(touch${IFS}PWNED2)`touch${IFS}PWNED3`";
  for (const [name, branch] of [["a", "feat-a"], ["b", "feat-b"], ["c", "feat-c"], ["d", "feat-d"], ["e", hostile]]) git(dir, "worktree", "add", "-q", wt(name), "-b", branch);
  write(wt("a"), "base.txt", "A\nb\nc\n"); write(wt("a"), "shared.txt", "one\n2\n3\n"); git(wt("a"), "commit", "-qam", "a");
  write(wt("a"), "not-committed.txt", "work in progress\n");
  write(wt("b"), "shared.txt", "uno\n2\n3\n"); write(wt("b"), "other.txt", "o\n"); git(wt("b"), "add", "-A"); git(wt("b"), "commit", "-qm", "b");
  write(wt("c"), "landed.txt", "x\ny\n"); git(wt("c"), "commit", "-qam", "c");
  write(wt("e"), "shared.txt", "1\n2\nthree\n"); git(wt("e"), "commit", "-qam", "e");
  // The default branch moves: base.txt changes under feat-a, and feat-c lands as a squash. The local main stays behind.
  write(dir, "base.txt", "a\nb\nC\n"); write(dir, "landed.txt", "x\ny\n"); git(dir, "commit", "-qam", "main moves"); git(dir, "push", "-q", "origin", "main");
  git(dir, "reset", "-q", "--hard", "HEAD~1");

  const a = report(wt("a"));
  assert.equal(a.status, 0, output(a));
  assert.match(a.stdout, /^parallel-sessions: feat-a\nbase: origin\/main at [0-9a-f]+ \(fetched just now\)\n/);
  assert.match(a.stdout, /this branch: 1 commit\(s\) behind origin\/main, 1 of its own, 3 file\(s\) changed/, "the file that is not committed counts");
  assert.match(a.stdout, /\n  CATCH UP NOW: origin\/main changed 1 file\(s\) this branch also changes: base\.txt\n  how: commit, then git rebase origin\/main \(no commit of the branch is pushed\)\n/);
  assert.match(a.stdout, /the local main is 1 commit\(s\) behind origin\/main/);
  assert.match(a.stdout, /\n  feat-b — [^\n]*\n[^\n]*\n      1 file\(s\) in common with this branch: shared\.txt\n      merging the two CONFLICTS in: shared\.txt\n/);
  assert.ok(a.stdout.includes(`\n  ${hostile} — `), "a branch name is printed as it is");
  assert.match(a.stdout, /1 file\(s\) in common with this branch: shared\.txt\n      merging the two is clean as text/, "the same file, other lines");
  const idle = a.stdout.split("nothing left to merge")[1] ?? "";
  assert.match(idle, /\n  feat-c, 1 commit\(s\) behind/, "a branch that landed as a squash has nothing left to merge");
  assert.match(idle, /\n  feat-d, 1 commit\(s\) behind/, "nor has a branch with no commit");
  assert.doesNotMatch(a.stdout, /\n  main[ ,]/, "the main checkout sits on the default branch: the base, not a neighbour");
  assert.deepEqual(fs.readdirSync(root, { recursive: true }).filter((f) => /^PWNED[23]?$/.test(path.basename(String(f)))), [], "no part of a branch name was run");

  // A file changed here and not committed is in common too, but the forecast merges commits: the report says so.
  write(wt("a"), "other.txt", "mine, not committed\n");
  assert.match(report(wt("a"), "--no-fetch").stdout, /\n  feat-b — [^\n]*\n[^\n]*\n      2 file\(s\) in common with this branch: other\.txt, shared\.txt\n      merging the two CONFLICTS in: shared\.txt\n      your changes to 1 of them are not committed, and no forecast covers them: other\.txt\n/);
  fs.rmSync(path.join(wt("a"), "other.txt"));

  // Seen from a branch with nothing of its own: nothing to merge for it, but feat-a has a merge to do.
  const d = report(wt("d"), "--no-fetch");
  assert.match(d.stdout, /\(as last fetched\)\n/);
  assert.match(d.stdout, /\n  what origin\/main changed since the fork touches none of the files this branch changes\n  before a pull request, catch up all the same: git rebase origin\/main \(no commit of the branch is pushed\)\n/, "behind on other files: nothing urgent, and still no base for a pull request");
  assert.match(d.stdout, /\n  feat-a — [^\n]*\n[^\n]*\n      origin\/main changed 1 of its file\(s\) since it forked: it has a merge to do\n      no file in common with this branch\n/);
  write(wt("d"), "other.txt", "mine, not committed\n");
  assert.match(report(wt("d"), "--no-fetch").stdout, /\n  feat-b — [^\n]*\n[^\n]*\n      1 file\(s\) in common with this branch: other\.txt\n      your changes to 1 of them are not committed, and no forecast covers them: other\.txt\n/, "no commit of this branch holds the file: nothing is forecast");
  fs.rmSync(path.join(wt("d"), "other.txt"));

  // --check is what the guard prints: one line when the branch is behind, the files changed on both sides first; silence otherwise.
  assert.match(report(wt("a"), "--check").stdout, /^origin\/main, as last fetched, changed 1 file\(s\) this branch also changes \(base\.txt\): catch up before you push — git rebase origin\/main \(no commit of the branch is pushed\)\n$/);
  assert.match(report(wt("d"), "--check").stdout, /^origin\/main, as last fetched, is 1 commit\(s\) ahead of this branch: catch up before a pull request — git rebase origin\/main \(no commit of the branch is pushed\)\n$/);
  git(dir, "worktree", "add", "-q", wt("f"), "-b", "feat-f", "origin/main");
  assert.match(report(wt("f"), "--no-fetch").stdout, /\n  up to date with origin\/main\n/);
  assert.equal(report(wt("f"), "--check").stdout, "", "nothing to report is silence, never \"up to date\"");
  const g = run(wt("a"), "bash", ["scripts/security-checks.sh", "--offline"], { env });
  assert.equal(g.status, 0, `a stale base is a note, the gate stays green:\n${output(g)}`);
  assert.match(g.stdout, /note\s+PS-2: origin\/main, as last fetched, changed 1 file/);
  assert.doesNotMatch(output(run(wt("a"), "bash", ["scripts/guards.d/18-parallel-sessions.sh"], { env: { ...env, CI: "true" } })), /PS-2/, "silent on a runner");

  // It only reads: the trial merges leave no object behind, and without a fetch no ref moves.
  const state = () => `${git(wt("a"), "count-objects", "-v").replace(/^(?!count|in-pack).*\n?/gm, "")}${git(wt("a"), "for-each-ref")}${git(wt("b"), "status", "--porcelain")}`;
  const before = state();
  assert.equal(report(wt("a"), "--no-fetch").status, 0);
  assert.equal(state(), before);

  // A detached HEAD reports like a branch; a neighbour on one is counted, not compared.
  git(wt("b"), "checkout", "-q", "--detach");
  assert.match(report(wt("b"), "--no-fetch").stdout, /^parallel-sessions: a detached HEAD at [0-9a-f]+\n/);
  assert.match(report(wt("b"), "--no-fetch").stdout, /\n  before a pull request, catch up all the same: rebase on origin\/main, or merge it once commits of the branch are pushed\n/, "no branch to look up on the remote: both ways are named");
  const seen = report(wt("a"), "--no-fetch").stdout;
  assert.match(seen, /\n1 other worktree\(s\) on a detached HEAD: not compared\n/);
  assert.doesNotMatch(seen, /feat-b/);

  // A branch name on the remote with no commit of its own — a branch reused after its pull request was merged —
  // has nothing a rebase would rewrite.
  git(wt("d"), "push", "-q", "origin", "feat-d");
  assert.match(report(wt("d"), "--check").stdout, / — git rebase origin\/main \(no commit of the branch is pushed\)\n$/);

  // Once commits of the branch are pushed, catching up is a merge: a rebase would rewrite what the remote holds.
  git(wt("a"), "push", "-q", "origin", "feat-a");
  assert.match(report(wt("a"), "--no-fetch").stdout, /\n  how: commit, then git merge origin\/main \(commits of the branch are pushed: a rebase would need a forced push\)\n/);
});

// A session on another machine or in the cloud shares no worktree with this one: the report sees it through what it
// pushed. Staged with a second clone of the same bare "origin", whose commits carry fixed dates.
test("parallel-sessions: the report compares the branches pushed from elsewhere, newest first, and forgets deleted ones", () => {
  if (!kit.modules.has("parallel-sessions")) return;
  const root = tmp(), origin = path.join(root, "origin.git"), dir = path.join(root, "here"), away = path.join(root, "away");
  const env = { ...ENV, CI: "", GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid" };
  const gitAt = (date, cwd, ...args) => { const r = run(cwd, "git", ["-c", "commit.gpgsign=false", ...args], { env: { ...env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } }); assert.equal(r.status, 0, `git ${args.join(" ")}\n${output(r)}`); return r.stdout; };
  const git = (cwd, ...args) => gitAt("2026-06-01T12:00:00Z", cwd, ...args);
  const report = (...args) => run(dir, "bash", ["scripts/parallel-sessions.sh", ...args], { env });
  fs.mkdirSync(dir);
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  install(dir, ["parallel-sessions"]);
  git(dir, "init", "-q", "-b", "main");
  write(dir, "shared.txt", "1\n2\n3\n"); write(dir, "solo.txt", "s\n");
  git(dir, "add", "-A"); git(dir, "commit", "-qm", "init");
  git(dir, "remote", "add", "origin", origin); git(dir, "push", "-q", "origin", "main");
  git(root, "clone", "-q", origin, away);
  git(dir, "checkout", "-qb", "mine"); write(dir, "shared.txt", "one\n2\n3\n"); git(dir, "commit", "-qam", "mine");
  // Pushed from the other clone: a branch that conflicts with this one, one on another file, one with a name a shell
  // would run, one with nothing of its own, and eleven older ones.
  const hostile = "x;touch${IFS}PWNED$(touch${IFS}PWNED2)`touch${IFS}PWNED3`";
  const push = (name, date, file, text) => {
    git(away, "checkout", "-q", "-b", name, "origin/main");
    if (file) { write(away, file, text); git(away, "add", "-A"); gitAt(date, away, "commit", "-qm", name); }
    git(away, "push", "-q", "origin", name);
  };
  push("cloud-conflict", "2026-06-03T12:00:00Z", "shared.txt", "uno\n2\n3\n");
  push("cloud-other", "2026-06-03T11:00:00Z", "other.txt", "o\n");
  push(hostile, "2026-06-03T10:00:00Z", "solo.txt", "S\n");
  push("cloud-empty");
  for (let i = 0; i < 11; i++) push(`old-${String(i).padStart(2, "0")}`, `2026-01-${String(i + 10).padStart(2, "0")}T12:00:00Z`, `old-${i}.txt`, "x\n");

  const r = report();
  assert.equal(r.status, 0, output(r));
  const section = r.stdout.split("branches pushed to origin with work of their own, no worktree here")[1] ?? "";
  assert.match(section, /^[^\n]*\n  origin\/cloud-conflict — pushed, last commit [^\n]*\n      1 commit\(s\) of its own on 1 file\(s\), 0 behind origin\/main\n      1 file\(s\) in common with this branch: shared\.txt\n      merging the two CONFLICTS in: shared\.txt\n  origin\/cloud-other — pushed, [^\n]*\n[^\n]*\n      no file in common with this branch\n/, "the most recent first, compared like a worktree's branch");
  assert.ok(section.includes(`\n  origin/${hostile} — pushed, `), "a branch name is printed as it is");
  assert.deepEqual(fs.readdirSync(root, { recursive: true }).filter((f) => /^PWNED[23]?$/.test(path.basename(String(f)))), [], "no part of a branch name was run");
  assert.match(section, /\n  origin\/old-04 — pushed, [^\n]*\n(?:      [^\n]*\n)+  … and 4 more, older\n/, "ten in full (three recent, seven old), the four oldest counted");
  assert.doesNotMatch(section, /old-0[0-3]/);
  assert.match(r.stdout, /\n1 other pushed branch\(es\) with nothing left to merge: origin\/cloud-empty\n/);
  assert.doesNotMatch(section, /origin\/(main|mine) /, "neither the base nor this branch's own copy");

  // This branch, once pushed, is not its own neighbour; a pushed branch a worktree here holds is compared once, as a worktree.
  git(dir, "push", "-q", "origin", "mine");
  git(dir, "worktree", "add", "-q", path.join(dir, ".claude/worktrees/w"), "cloud-other");
  const once = report();
  assert.doesNotMatch(once.stdout, /origin\/mine/);
  assert.match(once.stdout, /\nother worktrees whose branch holds changes:\n  cloud-other — /);
  assert.doesNotMatch(once.stdout, /origin\/cloud-other/);

  // A branch deleted on the remote stays until the next fetch, which forgets it.
  git(away, "push", "-q", "origin", "--delete", "cloud-conflict");
  assert.match(report("--no-fetch").stdout, /\n  origin\/cloud-conflict — /, "without a fetch, the state last fetched");
  assert.doesNotMatch(report().stdout, /origin\/cloud-conflict/, "the fetch prunes it");

  // --check, what the gate prints, says nothing of the pushed branches.
  assert.equal(report("--check").stdout, "");
});

// A guard that proves a workflow step's behaviour by running its script — the lines between `# harness:<x>-begin`
// and `# harness:<x>-end` — must also pin how that step runs. A key that skips the step, lets it fail or runs it
// under another shell hands the jobs that read its output an empty value, which the guard's table never sees.
// Every marked step of every module is checked: installed alone, its gate is green; with each such key added to
// the step, its job or the workflow, in a plain or a quoted spelling, the gate goes red.
test("a guard that runs a workflow step's script pins how the step runs: if, continue-on-error, shell, defaults", () => {
  let marked = 0;
  for (const [id, mod] of kit.modules) {
    for (const rel of walk(path.join(mod.dir, "files")).filter((r) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(r))) {
      const src = read(path.join(mod.dir, "files"), rel);
      const begin = /^( *)# harness:([a-z0-9-]+)-begin$/m.exec(src);
      if (!begin) continue;
      marked++;
      const dir = tmp();
      install(dir, [id]);
      const yml = read(dir, rel), lines = yml.split("\n");
      const at = lines.findIndex((l) => l === `${begin[1]}# harness:${begin[2]}-begin`);
      let step = at; while (step > 0 && !/^ *- /.test(lines[step])) step--;
      const stepKey = " ".repeat(lines[step].indexOf("-") + 2);
      let job = step; while (job > 0 && !/^  [A-Za-z0-9_-]+:\s*$/.test(lines[job])) job--;
      const top = lines.findIndex((l) => l === "jobs:");
      assert.ok(at > 0 && step > job && job > top && top > 0, `${id}: ${rel} — the marked step, its job and jobs: are found`);
      const r0 = gate(dir); assert.equal(r0.status, 0, `${id}: installed alone, the gate is green\n${output(r0)}`);
      const insert = (after, text) => [...lines.slice(0, after + 1), ...text.split("\n"), ...lines.slice(after + 1)].join("\n");
      const copies = [
        ["the step: if: false", insert(step, `${stepKey}if: false`)],
        ["the step: 'if': false", insert(step, `${stepKey}'if': false`)],
        ["the step: continue-on-error", insert(step, `${stepKey}continue-on-error: true`)],
        ["the step: \"continue-on-error\"", insert(step, `${stepKey}"continue-on-error": true`)],
        ["the step: shell", insert(step, `${stepKey}shell: sh {0}`)],
        ["the job: if: false", insert(job, "    if: false")],
        ["the job: continue-on-error", insert(job, "    continue-on-error: true")],
        ["the job: defaults", insert(job, "    defaults:\n      run:\n        shell: sh {0}")],
        ["the workflow: defaults", insert(top - 1, "defaults:\n  run:\n    shell: sh {0}")],
      ];
      for (const [why, text] of copies) {
        write(dir, rel, text);
        const r = gate(dir);
        assert.equal(r.status, 1, `${id}: ${rel} — a key added to ${why} must turn the gate red\n${output(r)}`);
      }
      write(dir, rel, yml);
    }
  }
  assert.ok(marked >= 1, "the scan found the marked steps it is meant to check");
});

// RG-5: a CI workflow that holds one job for session-active holds them all, or a held run ends `success` with
// checks skipped and ready-on-green may lift the draft on it. A CI workflow that holds nothing is not concerned.
test("RG-5: a CI workflow that holds a job for session-active holds every job, and runs them when the label comes off", () => {
  if (!kit.modules.has("ready-on-green")) return;
  const dir = tmp();
  install(dir, ["ready-on-green"]);
  const held = "!(github.event.pull_request.draft && contains(github.event.pull_request.labels.*.name, 'session-active'))";
  const ci = ({ name = "CI", types = "[opened, synchronize, reopened, unlabeled, ready_for_review]", first = `\${{ ${held} }}`, second = `\${{ ${held} && needs.lint.result == 'success' }}` } = {}) =>
    `name: ${name}\non:\n  pull_request:\n    types: ${types}\npermissions: {}\njobs:\n  lint:\n    if: ${first}\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n` +
    `  test:\n    needs: lint\n${second === null ? "" : `    if: ${second}\n`}    runs-on: ubuntu-latest\n    steps:\n      - run: true\n`;
  const rg5 = (text) => { write(dir, ".github/workflows/ci.yml", text); const r = gate(dir); return { r, line: output(r).split("\n").find((l) => l.includes("RG-5")) ?? "" }; };

  let { r, line } = rg5("name: CI\non: [pull_request]\npermissions: {}\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n");
  assert.equal(r.status, 0, output(r)); assert.match(line, /does not hold its jobs/);
  ({ r, line } = rg5(ci()));
  assert.equal(r.status, 0, output(r)); assert.match(line, /holds all its 2 job\(s\)/);
  ({ r, line } = rg5(ci({ name: "'CI' # quoted" })));
  assert.equal(r.status, 0, "the name is read quoted, as the digest reads it");
  ({ r, line } = rg5(ci({ name: "Other" })));
  assert.equal(r.status, 0); assert.match(line, /no workflow named CI here/);

  for (const [opts, re, why] of [
    [{ second: null }, /do not carry the hold[^\n]*: test/, "a job without the hold"],
    [{ second: `\${{ ${held} || github.event_name == 'push' }}` }, /: test/, "the hold undone by ||"],
    [{ second: `\${{ always() && ${held} }}` }, /: test/, "the hold not first"],
    [{ second: `\${{ !(github.event.pull_request.draft) }}` }, /: test/, "another condition"],
    [{ types: "[opened, synchronize, reopened, ready_for_review]" }, /types[^\n]*lack: unlabeled/, "no unlabeled type"],
    [{ types: "[opened, synchronize, reopened, unlabeled]" }, /lack: ready_for_review/, "no ready_for_review type"],
  ]) {
    ({ r, line } = rg5(ci(opts)));
    assert.equal(r.status, 1, `${why} turns RG-5 red`); assert.match(output(r), re, why);
  }
});

// ready-on-green: the step that picks the pull request whose draft green CI lifts, run as the runner runs it, with
// `gh` answering from a table — the pull requests it lifts, and the nearby ones that keep their draft. The step
// calls jq, as the runner provides it: without jq here, the test has nothing to run.
test("ready-on-green: which draft green CI lifts, and which keep theirs — session-active among them", () => {
  if (!kit.modules.has("ready-on-green") || run(KIT_ROOT, "jq", ["--version"]).status !== 0) return;
  const yml = read(kit.modules.get("ready-on-green").dir, "files/.github/workflows/ready-on-green.yml");
  const step = /\n      - name: Find PR for head_sha\n(?: {8}(?!run: \|)[^\n]*\n)* {8}run: \|\n((?: {10}[^\n]*\n|\n)+)/.exec(yml);
  assert.ok(step, "the step is in the workflow");
  const script = step[1].replace(/^ {10}/gm, "");
  assert.doesNotMatch(script, /\$\{\{/, "no expression in the script");
  const dir = tmp("harness-ready-");
  write(dir, "bin/gh", "#!/usr/bin/env bash\n# Stands in for `gh pr list … --jq FILTER`: the filter runs on the table.\nwhile [ $# -gt 0 ]; do case \"$1\" in --jq) filter=$2; shift 2 ;; *) shift ;; esac; done\nexec jq -c \"$filter\" \"$PRS\"\n", 0o755);
  const sha = "a".repeat(40);
  const pr = (number, extra = {}) => ({ number, headRefOid: sha, headRefName: `feature-${number}`, isDraft: true, labels: [], ...extra });
  const lift = (prs) => {
    write(dir, "prs.json", JSON.stringify(prs)); write(dir, "output", "");
    const env = { ...ENV, PATH: `${path.join(dir, "bin")}${path.delimiter}${process.env.PATH}`, PRS: path.join(dir, "prs.json"), HEAD_SHA: sha, DEFAULT_BRANCH: "main", GITHUB_OUTPUT: path.join(dir, "output"), GH_TOKEN: "unused" };
    const r = run(dir, "bash", ["-c", script], { env });
    assert.equal(r.status, 0, output(r));
    return { picked: /^pr=(\d+)$/m.exec(read(dir, "output"))?.[1] ?? null, log: r.stdout };
  };
  const cases = [
    ["a draft, CI green", [pr(7)], "7"],
    ["a draft with another label", [pr(7, { labels: [{ name: "documentation" }] })], "7"],
    ["a label that only begins the same", [pr(7, { labels: [{ name: "session-active-old" }] })], "7"],
    ["a draft labelled session-active", [pr(7, { labels: [{ name: "bug" }, { name: "session-active" }] })], null],
    ["not a draft", [pr(7, { isDraft: false })], null],
    ["a branch a CI Claude session wrote", [pr(7, { headRefName: "claude/issue-12" })], null],
    ["two pull requests with this head", [pr(7), pr(8)], null],
    ["a pull request that only contains the commit", [pr(7, { headRefOid: "b".repeat(40) })], null],
    ["no open pull request", [], null],
  ];
  for (const [what, prs, expected] of cases) assert.equal(lift(prs).picked, expected, what);
  assert.match(lift([pr(7, { labels: [{ name: "session-active" }] })]).log, /^::notice::PR #7 carries the session-active label: a session is still at work on it — its draft stays\.$/m);
});

test("parallel-sessions: without a remote, a commit or a repository, the report says so and --check says nothing", () => {
  if (!kit.modules.has("parallel-sessions")) return;
  const dir = tmp(), nowhere = tmp();
  const env = { ...ENV, CI: "", GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid", GIT_CEILING_DIRECTORIES: path.dirname(nowhere) };
  const script = path.join(dir, "scripts/parallel-sessions.sh");
  const report = (cwd, ...args) => run(cwd, "bash", [script, ...args], { env });
  install(dir, ["parallel-sessions"]);
  assert.equal(run(dir, "git", ["init", "-q", "-b", "main"], { env }).status, 0);
  let r = report(dir);
  assert.equal(r.status, 0); assert.match(r.stdout, /^parallel-sessions: no commit yet, nothing to compare\n$/);
  assert.equal(output(report(dir, "--check")), "\n", "--check has nothing to say, on either stream");
  for (const args of [["add", "-A"], ["-c", "commit.gpgsign=false", "commit", "-qm", "one"]]) assert.equal(run(dir, "git", args, { env }).status, 0);
  r = report(dir);
  assert.equal(r.status, 0, output(r));
  assert.match(r.stdout, /\nbase: main at [0-9a-f]+ \(the local branch: there is no origin\/main\)\n\nthis branch: 0 commit\(s\) behind main/);
  assert.match(r.stdout, /\nno other worktree on a branch of its own\n/);
  r = report(nowhere);
  assert.equal(r.status, 1); assert.match(r.stderr, /not inside a git working tree/);
  r = report(nowhere, "--check");
  assert.equal(r.status, 0); assert.equal(output(r), "\n");
  r = report(dir, "--fetch-harder");
  assert.equal(r.status, 2); assert.match(r.stderr, /^usage: /);
});

test("headroom: the gate goes red when a committed file routes sessions through a proxy or keeps Headroom's state", () => {
  if (!kit.modules.has("headroom")) return;
  // The kit is often installed by a session: the steps meant for a person's machine say so first.
  assert.match(listModules(kit).find((m) => m.id === "headroom").postInstall[0], /^For a person, to relay — the session that installs or updates the kit does none of these steps/);
  const pristine = tmp();
  install(pristine, ["headroom"]);
  // Each row starts from a fresh copy of the installed project. `links` maps a path to its symlink target.
  const project = (files = {}, forced = [], links = {}, before, after) => {
    const dir = tmp();
    fs.cpSync(pristine, dir, { recursive: true });
    for (const [rel, text] of Object.entries(files)) write(dir, rel, typeof text === "string" ? text : `${JSON.stringify(text, null, 2)}\n`);
    for (const [rel, target] of Object.entries(links)) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.symlinkSync(target, path.join(dir, rel)); }
    assert.equal(run(dir, "git", ["init", "-q", "-b", "main"]).status, 0);
    if (before) before(dir);
    assert.equal(run(dir, "git", ["add", "-A"]).status, 0);
    if (forced.length) assert.equal(run(dir, "git", ["add", "-f", ...forced]).status, 0);
    if (after) after(dir);
    return run(dir, "bash", ["scripts/security-checks.sh", "--offline"], { env: { ...ENV, CI: "" } });
  };
  const red = (label, id, files, forced, links, before, after) => {
    const r = project(files, forced, links, before, after);
    assert.equal(r.status, 1, `${label}: the gate must fail\n${output(r)}`);
    assert.match(r.stderr, new RegExp(`FAIL\\s+${id}:`), `${label}\n${output(r)}`);
    return r;
  };
  const green = (label, files, forced, links) => {
    const r = project(files, forced, links);
    assert.equal(r.status, 0, `${label}: the gate must pass\n${output(r)}`);
    assert.doesNotMatch(output(r), /(FAIL|skip)\s+HR-\d:|HR-\d: [^\n]*not checked/, label);
    return r;
  };
  const S = ".claude/settings.json";
  const env = (e) => ({ [S]: { env: e } });
  const wf = (body) => `on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n${body}    steps:\n      - run: true\n`;

  green("core and headroom alone", {});
  // HR-1, settings: any committed base URL or proxy, whatever the host or the provider.
  for (const url of ["http://127.0.0.1:8787", "http://localhost:8787", "http://[::1]:8787", "https://gateway.example.com"]) red(`ANTHROPIC_BASE_URL=${url}`, "HR-1", env({ ANTHROPIC_BASE_URL: url }));
  for (const k of ["ANTHROPIC_VERTEX_BASE_URL", "ANTHROPIC_FOUNDRY_BASE_URL", "ANTHROPIC_BEDROCK_BASE_URL", "ANTHROPIC_AWS_BASE_URL", "HTTPS_PROXY", "http_proxy", "ALL_PROXY"]) red(k, "HR-1", env({ [k]: "http://127.0.0.1:8787" }));
  red("a Headroom session header", "HR-1", env({ ANTHROPIC_CUSTOM_HEADERS: "X-Headroom-Project: demo" }));
  red("a nested settings file", "HR-1", { "packages/api/.claude/settings.json": { env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:8787" } } });
  red("a settings file spelled with capitals, which macOS and Windows open as settings.json", "HR-1", { ".claude/Settings.json": { env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:8787" } } }, [".claude/Settings.json"]);
  red("a session-start hook running headroom", "HR-1", { [S]: { hooks: { SessionStart: [{ hooks: [{ type: "command", command: "/usr/local/bin/headroom init hook ensure" }] }] } } });
  for (const host of ["localhost", "127.1", "[0:0:0:0:0:0:0:1]", "devbox"]) red(`an http hook on ${host}:8787`, "HR-1", { [S]: { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "http", url: `http://${host}:8787/hook` }] }] } } });
  red("a status line polling the proxy", "HR-1", { [S]: { statusLine: { type: "command", command: "curl -s http://127.0.0.1:8787/stats" } } });
  red("a key helper going through headroom", "HR-1", { [S]: { apiKeyHelper: "headroom key" } });
  red("an MCP server in the settings file", "HR-1", { [S]: { mcpServers: { ctx: { type: "http", url: "http://127.0.0.1:8787/mcp" } } } });
  red("the headroom plugin enabled", "HR-1", { [S]: { enabledPlugins: { "headroom@headroom-marketplace": true } } });
  red("its marketplace declared", "HR-1", { [S]: { extraKnownMarketplaces: { tools: { source: { source: "github", repo: "headroomlabs-ai/headroom" } } } } });
  red("a settings file that is not JSON", "HR-1", { [S]: "{ not json\n" });
  // HR-1, .mcp.json and plugins committed in the repository.
  red("a project MCP server running headroom", "HR-1", { ".mcp.json": { mcpServers: { compress: { command: "headroom", args: ["mcp", "serve"] } } } });
  red("a project MCP server on the proxy's port", "HR-1", { "tools/.mcp.json": { mcpServers: { ctx: { type: "http", url: "http://127.0.0.1:8787/mcp" } } } });
  red(".mcp.json spelled with capitals", "HR-1", { ".MCP.json": { mcpServers: { compress: { command: "headroom", args: ["mcp", "serve"] } } } });
  red("a plugin of an in-repository marketplace with a headroom hook", "HR-1", { [S]: { enabledPlugins: { "compress@local": true } }, "plugins/compress/hooks/hooks.json": { hooks: { SessionStart: [{ hooks: [{ type: "command", command: "headroom init hook ensure" }] }] } } });
  // HR-1, symlinks: git lists the link and never what is behind it.
  red("a .claude directory committed as a symlink", "HR-1", { "tooling/claude/settings.json": { env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:8787" } } }, [], { "packages/api/.claude": "../../tooling/claude" });
  red(".mcp.json committed as a symlink", "HR-1", { "tooling/servers.json": { mcpServers: {} } }, [], { ".mcp.json": "tooling/servers.json" });
  // HR-1, workflows and composite actions.
  red("a workflow setting the base URL", "HR-1", { ".github/workflows/agent.yml": wf("    env:\n      ANTHROPIC_BASE_URL: http://127.0.0.1:8787\n") });
  red("a workflow naming the headers, even in a comment", "HR-1", { ".github/workflows/agent.yaml": "on: push\n# ANTHROPIC_CUSTOM_HEADERS: X-Headroom-Project\njobs: {}\n" });
  red("a workflow whose name is not ASCII", "HR-1", { ".github/workflows/déploiement.yml": wf("    env:\n      ANTHROPIC_BASE_URL: http://127.0.0.1:8787\n") });
  red("a composite action", "HR-1", { ".github/actions/claude/action.yml": "runs:\n  using: composite\n  steps:\n    - run: echo \"ANTHROPIC_BASE_URL=http://127.0.0.1:8787\" >> \"$GITHUB_ENV\"\n      shell: bash\n" });
  red("a name spelled with a YAML escape", "HR-1", { ".github/workflows/agent.yml": wf("    env:\n      \"ANTHROPIC\\x5FBASE_URL\": http://127.0.0.1:8787\n") });
  red("a name split across an escaped line break", "HR-1", { ".github/workflows/agent.yml": wf("    env:\n      ? \"HTTPS_\\\n        PROXY\"\n      : http://127.0.0.1:8787\n") });
  const r = red("a proxy for a job with no Claude session", "HR-1", { ".github/workflows/ci.yml": wf("    env:\n      HTTPS_PROXY: http://proxy.internal:3128\n") });
  assert.match(r.stderr, /refused in every workflow and action, whatever the job/);
  // HR-1, what a second adversarial pass found.
  red("a name split over three continued lines in a run block", "HR-1", { ".github/workflows/agent.yml": wf("") + "      - run: |\n          echo ANTHROPIC\\\n          _BASE\\\n          _URL=http://x >> \"$GITHUB_ENV\"\n" });
  red("a name split over three lines of a double-quoted scalar", "HR-1", { ".github/workflows/agent.yml": wf("    env:\n      V: \"ANTHROPIC\\\n        _BASE\\\n        _URL=http://x\"\n") });
  red("a continued name in a CRLF workflow", "HR-1", { ".github/workflows/agent.yml": wf("").replace(/\n/g, "\r\n") + "      - run: echo ANTHROPIC_BASE\\\r\n          _URL=http://x >> \"$GITHUB_ENV\"\r\n" });
  red("a composite action under a directory holding '='", "HR-1", { "act=x/action.yml": "runs:\n  using: composite\n  steps:\n    - run: echo \"HTTPS_PROXY=http://x\" >> \"$GITHUB_ENV\"\n      shell: bash\n" });
  red("a name spelled with shell octal escapes", "HR-1", { ".github/workflows/agent.yml": wf("") + "      - run: echo $'ANTHROPIC\\137BASE\\137URL=http://x' >> \"$GITHUB_ENV\"\n" });
  red("a workflow running headroom wrap", "HR-1", { ".github/workflows/agent.yml": wf("") + "      - run: pipx install 'headroom-ai[proxy]' && headroom wrap claude -- -p fix\n" });
  red("a port written with a leading zero", "HR-1", { ".mcp.json": { mcpServers: { ctx: { type: "http", url: "http://127.0.0.1:08787/mcp" } } } });
  red("a settings key the check did not list", "HR-1", { [S]: { fileSuggestion: { type: "command", command: "headroom wrap claude" } } });
  red("a plugin manifest pointing its hooks at another file", "HR-1", { "plugins/c/.claude-plugin/plugin.json": { name: "c", hooks: "./config/h.json" }, "plugins/c/config/h.json": { hooks: { SessionStart: [{ hooks: [{ type: "command", command: "./bin/start.sh" }] }] } }, "plugins/c/bin/start.sh": "#!/bin/sh\nexec headroom proxy --port 8787\n" });
  red("a settings file named with U+017F", "HR-1", { ".claude/ſettings.json": { env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:8787" } } }, [".claude/ſettings.json"]);
  red(".mcp.json named with U+017F", "HR-1", { ".mcp.jſon": { mcpServers: { compress: { command: "headroom" } } } });
  red("a submodule mounted at a .claude directory", "HR-1", {}, [], {}, undefined, (dir) => assert.equal(run(dir, "git", ["update-index", "--add", "--cacheinfo", `160000,${"1".repeat(40)},packages/api/.claude`]).status, 0));
  green("a symlink named hooks outside a plugin, and a CRLF .gitignore", { ".gitignore": read(pristine, ".gitignore").replace(/\n/g, "\r\n"), "lib/x.js": "export {};\n" }, [], { "src/hooks": "../lib" });
  // HR-1, what a third adversarial pass found: every committed file is read, as committed.
  const hook = (cmd) => ({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: cmd }] }] } });
  red("a plugin script under node_modules", "HR-1", { "plugins/p/.claude-plugin/plugin.json": { name: "p" }, "plugins/p/hooks/hooks.json": hook("${CLAUDE_PLUGIN_ROOT}/node_modules/.bin/start"), "plugins/p/node_modules/.bin/start": "#!/bin/sh\nexec headroom proxy\n" }, ["plugins/p/node_modules/.bin/start"]);
  red("a plugin script holding a NUL byte", "HR-1", { "plugins/p/.claude-plugin/plugin.json": { name: "p" }, "plugins/p/bin/start.sh": "#!/bin/sh\nheadroom proxy\n# \0\n" });
  red("a JSON file spelling the name with \\u escapes", "HR-1", { "plugins/p/cfg/h.json": "{\"command\": \"\\u0068eadroom proxy\"}\n" });
  red("a root plugin's monitor", "HR-1", { ".claude-plugin/plugin.json": { name: "root" }, "monitors/monitors.json": { monitors: [{ command: "headroom proxy --port 8787" }] } });
  red("an .envrc starting the proxy", "HR-1", { ".envrc": "headroom proxy &\n" });
  red("a Makefile reaching the port without a colon", "HR-1", { Makefile: "probe:\n\tnc 127.0.0.1 8787\n" });
  red("a hook reaching the port through /dev/tcp", "HR-1", { "scripts/probe.sh": "exec 3<>/dev/tcp/127.0.0.1/8787\n" });
  red("permissions.allow pre-approving the proxy", "HR-1", { [S]: { permissions: { allow: ["Bash(headroom proxy:*)"] } } });
  red("an agent whose frontmatter declares a hook", "HR-1", { ".claude/agents/fast.md": "---\nname: fast\nhooks:\n  SessionStart:\n    - command: headroom proxy\n---\n\nAn agent.\n" });
  red("a workflow saved as UTF-16", "HR-1", {}, [], {}, (dir) => { fs.mkdirSync(path.join(dir, ".github/workflows"), { recursive: true }); fs.writeFileSync(path.join(dir, ".github/workflows/ci.yml"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(wf("    env:\n      ANTHROPIC_BASE_URL: http://127.0.0.1:8787\n"), "utf16le")])); });
  red("a name joined across U+2028", "HR-1", { ".github/workflows/agent.yml": wf("    env:\n      ? \"ANTHROPIC_BASE\\         _URL\"\n      : http://x\n") });
  red("what is committed, not what is on the disk", "HR-1", { ".github/workflows/agent.yml": wf("    env:\n      ANTHROPIC_BASE_URL: http://127.0.0.1:8787\n") }, [], {}, undefined, (dir) => write(dir, ".github/workflows/agent.yml", wf("")));
  {
    // Installed in a sub-directory, the root's workflows and settings would go unchecked.
    const repo = tmp();
    write(repo, ".github/workflows/agent.yml", wf("    env:\n      ANTHROPIC_BASE_URL: http://127.0.0.1:8787\n"));
    fs.cpSync(pristine, path.join(repo, "apps/tool"), { recursive: true });
    assert.equal(run(repo, "git", ["init", "-q", "-b", "main"]).status, 0);
    assert.equal(run(repo, "git", ["add", "-A"]).status, 0);
    const r3 = run(path.join(repo, "apps/tool"), "bash", ["scripts/security-checks.sh", "--offline"], { env: { ...ENV, CI: "" } });
    assert.equal(r3.status, 1, output(r3));
    assert.match(r3.stderr, /FAIL\s+HR-1: this project is apps\/tool\/ inside a larger repository/);
  }
  green("Markdown prose about Headroom, a lockfile hash holding 8787, a deny rule", { "docs/notes.md": "We run Headroom on our laptops: see docs/conventions/headroom.md.\n", "package-lock.json": "{\"integrity\": \"sha512-ab8787cd\"}\n", [S]: { permissions: { deny: ["Bash(headroom:*)"], ask: ["Bash(curl http://127.0.0.1:8787/*)"] } } });
  // HR-1, what a fourth adversarial pass found (each run live against Claude Code with a stand-in headroom).
  const bang = "!" + "`";
  red("a command whose body runs dynamic shell context", "HR-1", { ".claude/commands/tidy.md": "---\ndescription: Tidy\nallowed-tools: Bash\n---\nStatus: " + bang + "headroom proxy`\n" });
  red("a skill whose body holds a fenced block that runs", "HR-1", { ".claude/skills/tidy/SKILL.md": "---\nname: tidy\ndescription: Use for every task\n---\n```!\nheadroom proxy &\n```\n" });
  red("a frontmatter closed by three dashes and a space", "HR-1", { ".claude/agents/helper.md": "---\nname: helper\nhooks:\n  PreToolUse:\n    - command: headroom proxy\n--- \nAn agent.\n" });
  red("a frontmatter that is never closed", "HR-1", { ".claude/agents/open.md": "---\nname: open\nhooks:\n  PreToolUse:\n    - command: headroom proxy\n" });
  red("a symlink whose target is the headroom binary", "HR-1", { [S]: hook("\"$CLAUDE_PROJECT_DIR\"/tools/compress proxy") }, [], { "tools/compress": "/usr/local/bin/headroom" });
  red("the port as a call argument", "HR-1", { ".claude/hooks/warm.js": "require(\"net\").connect(8787, \"127.0.0.1\");\n" });
  red("the port at the start of a line", "HR-1", { ".claude/hooks/probe.sh": "args=(\n127.0.0.1\n8787\n)\nexec nc -z \"${args[@]}\"\n" });
  green("a Markdown body that only talks about Headroom, a version and a port inside a longer number", { "docs/howto.md": "---\ntitle: How we work\n---\nWe start Headroom by hand; `npm i lib@1.8787.0`.\n", "config/ports.json": "{\"dev\": 18787, \"build\": \"v1.8787\"}\n" });
  // HR-2: one machine's files, force-added past .gitignore.
  for (const rel of [".claude/settings.local.json", ".claude/.headroom_wrap_marker.json", ".headroom/memory.db", "services/web/.headroom/memory.db", ".Headroom/memory.db", "CLAUDE.local.md", "docs/CLAUDE.local.md", "packages/api/.claude/.headroom_wrap_owners.json"]) red(`${rel} tracked`, "HR-2", { [rel]: "{}\n" }, [rel]);
  {
    const without = read(pristine, ".gitignore").replace(/^\.headroom\/$/m, "");
    const r2 = red("the .gitignore block removed, even when a local exclude file still lists .headroom/", "HR-2", { ".gitignore": without }, [], {}, (dir) => write(dir, ".git/info/exclude", ".headroom/\n"));
    assert.match(r2.stderr, /HR-2: \.gitignore no longer holds the claude-template:headroom block/);
  }
  // HR-3: a learn block in any tracked file, the convention page included.
  const block = "<!-- headroom:learn:start -->\n- prefer rg\n<!-- headroom:learn:end -->\n";
  red("a learn block in CLAUDE.md", "HR-3", { "CLAUDE.md": block });
  red("a learn block in another tracked file", "HR-3", { "docs/AGENTS.md": block });
  red("a learn block appended to the convention page", "HR-3", { "docs/conventions/headroom.md": `${read(pristine, "docs/conventions/headroom.md")}\n${block}` });
  // What stays green.
  green("ENABLE_TOOL_SEARCH, NO_PROXY and a deny rule naming headroom", { [S]: { env: { ENABLE_TOOL_SEARCH: "true", NO_PROXY: "localhost" }, permissions: { deny: ["Bash(headroom:*)"] } } });
  green("an unrelated MCP server on another port", { ".mcp.json": { mcpServers: { docs: { type: "http", url: "http://localhost:18787/mcp" } } } });
  green("a learn block in the ignored CLAUDE.local.md", { "CLAUDE.local.md": block });
  green("a workflow naming the API key and NO_PROXY, with a shell continuation and a colour escape", { ".github/workflows/ci.yml": wf("    env:\n      ANTHROPIC_API_KEY: ${{ secrets.KEY }}\n      NO_PROXY: localhost\n") + "      - run: |\n          printf '\\x1b[32mok\\x1b[0m\\n'\n          curl -s \\\n            https://example.com\n" });
});

// The CI skeleton's guard (31-ci-workflow.sh): broken copies of ci.yml turn CW-1, CW-2 or CW-3 red; the shipped one and
// the shapes a project gives it stay green. Each red row sits next to a green one: a filter next to none, the security
// job gated next to a project job gated, the script forced next to the script as shipped.
test("ci-workflow: broken copies of ci.yml turn CW-1, CW-2 or CW-3 red; the shipped one and a project's jobs stay green", async () => {
  if (!kit.modules.has("ci-workflow")) return;
  const pristine = tmp();
  install(pristine, ["ci-workflow"]);
  assert.equal(run(pristine, "git", ["init", "-q", "-b", "main"]).status, 0);
  const file = ".github/workflows/ci.yml";
  const shipped = read(pristine, file);
  const once = (text, from, to) => { assert.equal(text.split(from).length, 2, `${JSON.stringify(from.slice(0, 60))}: once expected`); return text.replace(from, () => to); };
  const guard = (label, text) => new Promise((resolve) => {
    const dir = tmp();
    fs.cpSync(pristine, dir, { recursive: true });
    if (text !== undefined) fs.writeFileSync(path.join(dir, file), text);
    const child = spawn("bash", ["scripts/guards.d/31-ci-workflow.sh"], { cwd: dir, env: { ...ENV, CI: "" } });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (status) => resolve({ label, status, stdout, stderr }));
  });
  const securityUses = "    uses: $/.github/workflows/security.yml\n";
  const end = "          # harness:changes-end\n";
  const projectJob = "\n  test:\n    needs: [security, changes]\n    if: needs.changes.outputs.code != 'false'\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n    permissions:\n      contents: read\n    steps:\n      - run: echo test\n";
  const changesJob = shipped.slice(shipped.indexOf("\n  # Whether anything outside"), shipped.indexOf("\n  # TODO(harness)"));
  const greens = [
    ["as shipped", undefined],
    ["a project job gated on changes, and one that runs on documentation too", shipped + projectJob + "\n  links:\n    needs: [security]\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    permissions: {}\n    steps:\n      - run: echo links\n"],
    ["no changes job: every job runs on every change", shipped.replace(changesJob, "")],
    ["a comment that names paths in the triggers", once(shipped, "  push:\n", "  # no paths: filter here\n  push:\n")],
  ];
  const cases = [
    ["paths-ignore on push", "CW-1", once(shipped, "  push:\n    branches: [main]\n", "  push:\n    branches: [main]\n    paths-ignore: ['docs/**', '**.md']\n")],
    ["paths on pull_request", "CW-1", once(shipped, "    types: [opened, synchronize, reopened, edited]\n", "    types: [opened, synchronize, reopened, edited]\n    paths: ['**', '!docs/**']\n")],
    ["paths in a quoted key", "CW-1", once(shipped, "    types: [opened, synchronize, reopened, edited]\n", "    types: [opened, synchronize, reopened, edited]\n    \"paths\": ['src/**']\n")],
    ["no push trigger", "CW-1", once(shipped, "  push:\n    branches: [main]\n", "")],
    ["the security job waits for changes", "CW-2", once(shipped, securityUses, "    needs: [changes]\n" + securityUses)],
    ["the security job skipped on documentation", "CW-2", once(shipped, securityUses, "    if: needs.changes.outputs.code == 'true'\n" + securityUses)],
    ["the security job run on pushes only", "CW-2", once(shipped, securityUses, "    if: github.event_name == 'push'\n" + securityUses)],
    ["the diff step skipped", "CW-3", once(shipped, "        id: diff\n", "        id: diff\n        if: false\n")],
    ["the diff step allowed to fail", "CW-3", once(shipped, "        id: diff\n", "        id: diff\n        continue-on-error: true\n")],
    ["the changes job allowed to fail", "CW-3", once(shipped, "    timeout-minutes: 5\n", "    timeout-minutes: 5\n    continue-on-error: true\n")],
    ["the diff step run by another shell", "CW-3", once(shipped, "        id: diff\n", "        id: diff\n        shell: sh {0}\n")],
    ["the changes job skipped, key quoted", "CW-3", once(shipped, "    timeout-minutes: 5\n", "    timeout-minutes: 5\n    'if': false\n")],
    ["no job calls security.yml", "CW-2", once(shipped, securityUses, "    runs-on: ubuntu-latest\n    steps:\n      - run: echo none\n")],
    ["the script forced to false", "CW-3", once(shipped, "          code=true\n", "          code=false\n")],
    ["a value written after the script", "CW-3", once(shipped, end, end + "          echo \"code=false\" >> \"$GITHUB_OUTPUT\"\n")],
    ["a value written before the script", "CW-3", once(shipped, "          # harness:changes-begin\n", "          echo \"code=false\" >> \"$GITHUB_OUTPUT\"\n          # harness:changes-begin\n")],
    ["the output hard-coded", "CW-3", once(shipped, "      code: ${{ steps.diff.outputs.code }}\n", "      code: 'false'\n")],
    ["a second output", "CW-3", once(shipped, "      code: ${{ steps.diff.outputs.code }}\n", "      code: ${{ steps.diff.outputs.code }}\n      docs: 'true'\n")],
    ["the event rewired", "CW-3", once(shipped, "          EVENT: ${{ github.event_name }}\n", "          EVENT: pull_request\n")],
    ["renames detected", "CW-3", once(shipped, "git diff --no-renames --name-only", "git diff --name-only")],
    ["any pull request taken for a merge commit", "CW-3", once(shipped, `if [ "$EVENT" = pull_request ] && git rev-parse -q --verify 'HEAD^2' >/dev/null; then`, `if [ "$EVENT" = pull_request ]; then`)],
    ["any push taken for one commit", "CW-3", once(shipped, `elif [ "$EVENT" = push ] && [ -n "$BEFORE" ] && [ "$(git rev-parse -q --verify 'HEAD^1' || true)" = "$BEFORE" ]; then`, `elif [ "$EVENT" = push ]; then`)],
    ["a wider documentation set that takes workflows", "CW-3", once(shipped, `docs='(\\.md$|^docs/|^LICENSE$|^\\.gitignore$)'`, `docs='(\\.md$|^docs/|^\\.github/|^LICENSE$|^\\.gitignore$)'`)],
  ];
  const results = await Promise.all([...greens, ...cases.map(([label, , text]) => [label, text])].map(([label, text]) => guard(label, text)));
  for (const r of results.slice(0, greens.length)) assert.equal(r.status, 0, `${r.label}: the guard must pass\n${r.stdout}\n${r.stderr}`);
  for (const [i, r] of results.slice(greens.length).entries()) {
    assert.equal(r.status, 1, `${r.label}: the guard must fail\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, new RegExp(`FAIL\\s+${cases[i][1]}:`), `${r.label}\n${r.stdout}\n${r.stderr}`);
  }
});

test("auto-merge: broken copies of the workflow turn AM-1, AM-7, AM-8, AM-10 or AM-11 red; the shipped one, a documented dispatch and accepted CI names stay green", async () => {
  if (!kit.modules.has("auto-merge")) return;
  const pristine = tmp();
  install(pristine, ["auto-merge"]);
  assert.equal(run(pristine, "git", ["init", "-q", "-b", "main"]).status, 0);
  assert.equal(run(pristine, "git", ["add", "-A"]).status, 0);
  const file = ".github/workflows/auto-merge.yml";
  const shipped = read(pristine, file);
  // Every line containing `fragment` (`times` of them in the file) becomes the lines `by`, at its indentation; `skip`
  // more lines after it are dropped. `by` = [] drops the line.
  const edit = (text, fragment, times, by, skip = 0) => {
    const from = text.split("\n"), to = [];
    let n = 0;
    for (let i = 0; i < from.length; i++) {
      if (!from[i].includes(fragment)) { to.push(from[i]); continue; }
      n++;
      to.push(...[].concat(by).map((line) => from[i].match(/^ */)[0] + line));
      i += skip;
    }
    assert.equal(n, times, `${JSON.stringify(fragment)}: ${n} line(s), ${times} expected`);
    return to.join("\n");
  };
  // Inside every block opened by a line containing `opener`, up to its `fi`, the line `line` (trimmed) becomes `by`.
  const inBlock = (text, opener, times, line, by) => {
    const to = [];
    let n = 0, open = false;
    for (const l of text.split("\n")) {
      if (l.includes(opener)) { open = true; n++; to.push(l); continue; }
      if (open && l.trim() === "fi") open = false;
      if (open && l.trim() === line) { to.push(...[].concat(by).map((b) => l.match(/^ */)[0] + b)); continue; }
      to.push(l);
    }
    assert.equal(n, times, `${JSON.stringify(opener)}: ${n} block(s), ${times} expected`);
    return to.join("\n");
  };
  // Every block opened by a line containing `opener` dropped, up to and with its `fi`.
  const dropBlock = (text, opener, times) => {
    const to = [];
    let n = 0, open = false;
    for (const l of text.split("\n")) {
      if (!open && l.includes(opener)) { open = true; n++; continue; }
      if (open) { if (l.trim() === "fi") open = false; continue; }
      to.push(l);
    }
    assert.equal(n, times, `${JSON.stringify(opener)}: ${n} block(s), ${times} expected`);
    return to.join("\n");
  };
  // Each copy in a project of its own, the guard run on it (a second or two each).
  const guard = async (label, text) => {
    const dir = tmp();
    await fs.promises.cp(pristine, dir, { recursive: true });
    if (text !== undefined) await fs.promises.writeFile(path.join(dir, file), text);
    return new Promise((resolve) => {
      const child = spawn("bash", ["scripts/guards.d/40-auto-merge.sh"], { cwd: dir, env: { ...ENV, CI: "" } });
      let stdout = "", stderr = "";
      child.stdout.on("data", (d) => { stdout += d; });
      child.stderr.on("data", (d) => { stderr += d; });
      child.on("close", (status) => resolve({ label, status, stdout, stderr }));
    });
  };
  // The runs with their concurrency bounded by the processor count: the same work, without a burst of
  // processes on a small runner.
  const bounded = async (jobs) => {
    const results = [];
    let next = 0;
    const worker = async () => { for (let i = next++; i < jobs.length; i = next++) results[i] = await jobs[i](); };
    const concurrency = Math.min(jobs.length, Math.max(1, os.availableParallelism()));
    await Promise.all(Array.from({ length: concurrency }, worker));
    return results;
  };
  // Exactly one occurrence of `from` (with its newline) replaced by `to`.
  const once = (text, from, to) => {
    assert.equal(text.split(from).length, 2, `${JSON.stringify(from.slice(0, 60))}: once expected`);
    return text.replace(from, () => to);
  };
  // The last occurrence of `from` replaced by `to`.
  const last = (text, from, to) => {
    const i = text.lastIndexOf(from);
    assert.ok(i >= 0, `${JSON.stringify(from.slice(0, 60))}: not found`);
    return text.slice(0, i) + to + text.slice(i + from.length);
  };
  const ind = (n, line) => " ".repeat(n) + line + "\n";
  const checkName = ind(6, "- name: Check what the merge wrote") + ind(8, "id: check");
  const checkIf = ind(8, "if: ${{ !cancelled() && steps.merge.outputs.merged == 'true' }}");
  const shaLine = ind(16, "echo \"sha=$(jq -r '.sha // empty' <<< \"$OUT\")\" >> \"$GITHUB_OUTPUT\"");
  const verdict = 'if [ "$WROTE_COUNT" -ge 300 ] || [ "$HELD" != "0" ] || [ "$WEAKENED" != "0" ]; then';
  const firstCheck = shipped.indexOf(checkName), slot = shipped.indexOf("      # Nothing is dispatched after the merge");
  assert.ok(firstCheck > 0 && slot > firstCheck, "promote-from-ci's check step, then the dispatch slot");
  const loopHead = ind(10, "for attempt in 1 2 3 4 5; do");
  const ciLoop = ind(10, "# post-merge dispatch would use.") + loopHead;
  const checkRun = ind(10, "set -euo pipefail") + ind(10, "# The commit the merge created, listed against its first parent: the");
  const notShown = 'echo "::error::PR #${PR} is not shown merged by this workflow after its last merge call. A call can merge and answer an error, and the pull request can show it late: check whether it is merged. If github-actions[bot] merged it, read its merge commit — a re-run does not check it; if a person did, nothing is left to do here; if it is not merged, merge it by hand."';
  const on409 = ind(18, "exit 0 ;;") + ind(14, "esac");
  const methodsHead = loopHead + ind(12, "for method in squash merge; do");
  const gateEnv = ind(8, "id: gate") + ind(8, "if: steps.find-pr.outputs.pr != '' && steps.signoff.outputs.ok == 'true'") + ind(8, "env:");
  const cleanup = ind(6, "# Delete the head ref ourselves (see the header). `!cancelled()` keeps it");
  // Every occurrence of `from` (`times` of them) replaced by `to`.
  const every = (text, from, times, to) => {
    assert.equal(text.split(from).length, times + 1, `${JSON.stringify(from.slice(0, 60))}: ${times} expected`);
    return text.split(from).join(to);
  };
  // The CI workflow's name is a value of the installation: names the installer accepts, each rendered.
  const named = ["Lambda function tests", "sudoers lint", "STATE machine tests", "CI MB", "PR merge base.sha lint.jq BASH_ENV", "sudo function STATE MB PUT TIP enable"].map((name) => {
    const dir = tmp();
    install(dir, ["auto-merge"], { given: { PROJECT_NAME: "demo-app", CI_WORKFLOW: name } });
    return [name, read(dir, file)];
  });
  const sudoers = named.find(([name]) => name === "sudoers lint")[1];
  // The dispatch § After the merge describes, written the usual ways: a step opened by its `if`, a run block, and
  // names of its own that the gate and the merge step use too.
  const dispatch = once(once(shipped, ind(6, "actions: read # the sign-offs: the runs of CI and of the review"), ind(6, "actions: write # the sign-offs, and the dispatch after a merge")), cleanup,
    ind(6, "- name: Dispatch the deploy")
    + ind(8, "if: ${{ !cancelled() && steps.merge.outputs.merged == 'true' && steps.check.outcome == 'success' }}")
    + ind(8, "env:") + ind(10, "GH_TOKEN: ${{ github.token }}") + ind(10, "MERGE_SHA: ${{ steps.merge.outputs.sha }}")
    + ind(8, 'run: gh workflow run deploy.yml --ref main -f merged_sha="$MERGE_SHA"') + "\n"
    + ind(6, "- if: ${{ !cancelled() && steps.merge.outputs.merged == 'true' && steps.check.outcome == 'success' }}")
    + ind(8, "name: Dispatch the end-to-end tests")
    + ind(8, "env:") + ind(10, "GH_TOKEN: ${{ github.token }}") + ind(10, "MERGE_SHA: ${{ steps.merge.outputs.sha }}")
    + ind(8, "run: |") + ind(10, "set -euo pipefail")
    + ind(10, 'STATE=$(gh api "repos/${GITHUB_REPOSITORY}/actions/workflows/e2e.yml" --jq .state)')
    + ind(10, 'TIP=$(gh api "repos/${GITHUB_REPOSITORY}/git/ref/heads/main" --jq .object.sha)')
    + ind(10, 'MB="$MERGE_SHA"')
    + ind(10, 'if [ "$STATE" = active ] && [ "$TIP" = "$MB" ]; then gh workflow run e2e.yml --ref main -f merged_sha="$MERGE_SHA"; fi')
    + "\n" + cleanup);
  // A dispatch that retries in the merge loop's own words, with a message, a JSON body and a jq key of its own, and
  // the gate's patterns named in its script: no YAML key, no definition, no merge loop.
  const retried = once(once(shipped, ind(6, "actions: read # the sign-offs: the runs of CI and of the review"), ind(6, "actions: write # the sign-offs, and the dispatch after a merge")), cleanup,
    ind(6, "- name: Dispatch the deploy, retried")
    + ind(8, "if: ${{ !cancelled() && steps.merge.outputs.merged == 'true' && steps.check.outcome == 'success' }}")
    + ind(8, "env:") + ind(10, "GH_TOKEN: ${{ github.token }}") + ind(10, "MERGE_SHA: ${{ steps.merge.outputs.sha }}")
    + ind(8, "run: |") + ind(10, "set -euo pipefail")
    + ind(10, 'echo "PROJECT_GATE_RE: $PROJECT_GATE_RE"')
    + ind(10, 'HELD_TESTS="${TEST_HOLD_RE:-^$}"')
    + ind(10, 'BODY=$(jq -n --arg k merged_sha --arg v "$MERGE_SHA" --arg h "$HELD_TESTS" \'{ref: "main", inputs: {"\\($k)": $v, held_tests: $h}}\')')
    + ind(10, 'JSON="{\\"ref\\":\\"main\\",\\"inputs\\":{\\"merged_sha\\":\\"$MERGE_SHA\\"}}"')
    + ind(10, "for attempt in 1 2 3 4 5; do")
    + ind(12, 'if gh api --method POST "repos/${GITHUB_REPOSITORY}/actions/workflows/deploy.yml/dispatches" --input - <<< "$BODY"; then')
    + ind(14, 'echo "::notice::Dispatched \\"deploy.yml\\": $MERGE_SHA ($JSON)"')
    + ind(14, "exit 0")
    + ind(12, "fi")
    + ind(12, 'echo "attempt ${attempt}: dispatch failed, retrying in ${attempt}s"')
    + ind(12, 'sleep "$attempt"')
    + ind(10, "done")
    + ind(10, "exit 1")
    + "\n" + cleanup);
  // The ways a head pushed since the validated commit ends: red after a call that answered a 5xx or nothing.
  const movedRed = 'echo "::error::PR #${PR}: head moved since the validated SHA, after a merge call that answered an error — such a call can merge, and the pull request can show it late. Check whether it is merged: if github-actions[bot] merged it, read its merge commit — a re-run does not check it; if not, its new head gets its own run."';
  const movedNotice = 'echo "::notice::PR #${PR}: head moved since the validated SHA — leaving it to its own run."';
  const ifCalled = 'if [ -n "${CALLED:-}" ]; then';
  const calledBlock = (n) => ind(n, ifCalled) + ind(n + 2, movedRed) + ind(n + 2, "exit 1") + ind(n, "fi");
  const headCheck = 'if [ "$NOW_HEAD" != "$HEAD_SHA" ]; then';
  const headBlock = (n) => ind(n, headCheck) + calledBlock(n + 2) + ind(n + 2, movedNotice) + ind(n + 2, "exit 0") + ind(n, "fi");
  // A job-level env added after each `timeout-minutes: 10`, its lines as given.
  const jobEnv = (...lines) => edit(shipped, "timeout-minutes: 10", 1, ["timeout-minutes: 10", ...lines]);
  const cases = [
    // Before each merge call: the pull request, the tip and the merge base, read again.
    ["the merge base not compared when the tip moved", "AM-7", inBlock(shipped, 'if [ "$NOW_MB" != "$GATE_MB" ]; then', 1, "exit 0", "true")],
    ["a failed read of the tip merges anyway", "AM-7", inBlock(shipped, 'if ! [[ "$NOW_TIP" =~ ^[0-9a-f]{40,64}$ ]]; then', 1, "exit 1", "true")],
    ["an unreadable merge base taken as unchanged", "AM-7", inBlock(shipped, 'if ! [[ "$NOW_MB" =~ ^[0-9a-f]{40,64}$ ]]; then', 1, "exit 1", "true")],
    ["a merge already made left unchecked", "AM-7", edit(shipped, 'echo "sha=${NOW_COMMIT}" >> "$GITHUB_OUTPUT"', 2, [])],
    ["a merge made by hand adopted", "AM-7", inBlock(shipped, 'if [ "$NOW_BY" != "github-actions[bot]" ]; then', 1, "exit 0", "true")],
    ["the head on the base branch taken for a moved merge base", "AM-7", edit(shipped, 'if [ "$NOW_MB" = "$HEAD_SHA" ]; then continue; fi', 1, [])],
    ["the last call's merge never read back", "AM-7", dropBlock(shipped, 'if [ "$NOW_MERGED" = "true" ] && [ "$NOW_BY" = "github-actions[bot]" ]; then', 1)],
    ["a merge by anyone adopted after the last call", "AM-7", edit(shipped, 'if [ "$NOW_MERGED" = "true" ] && [ "$NOW_BY" = "github-actions[bot]" ]; then', 1, 'if [ "$NOW_MERGED" = "true" ]; then')],
    ["a failed merge ends green", "AM-7", edit(shipped, notShown, 1, [notShown, "exit 0"])],
    ["a retarget not checked before each call", "AM-7", dropBlock(shipped, 'if [ -z "$BASE_REF" ] || [ "$NOW_BASE" != "$BASE_REF" ]; then', 1)],
    ["a head pushed since the gate not checked before each call", "AM-7", every(shipped, headBlock(14), 1, "")],
    // A head pushed since: red after a call that answered a 5xx or nothing (CALLED), which may have merged.
    ["a head moved after a call that may have merged left green, before a call", "AM-7", every(shipped, calledBlock(16), 1, "")],
    ["a head moved after a call that may have merged left green, at a 409", "AM-10", every(shipped, calledBlock(18), 1, "")],
    ["a head moved after a call that may have merged left green, after the last call", "AM-7", every(shipped, calledBlock(12), 1, "")],
    ["a head moved after a call that may have merged ending green", "AM-7", inBlock(shipped, ifCalled, 3, "exit 1", "exit 0")],
    ["a head pushed after the last call called a failed merge", "AM-7", every(shipped, headBlock(10), 1, "")],
    ["a call that answered a 5xx or nothing not noted", "AM-10", edit(shipped, "*) CALLED=1 ;;", 1, "*) ;;")],
    ["every failed call taken for a refusal", "AM-10", edit(shipped, '*"(HTTP 4"[0-9][0-9]")"*) ;;', 1, '*"(HTTP "*) ;;')],
    ["CALLED assigned outside its pinned lines", "AM-7", every(shipped, loopHead, 1, ind(10, 'CALLED=""') + loopHead)],
    ["a closed pull request called anyway, or called failed after the last call", "AM-7", dropBlock(shipped, 'if [ "$NOW_STATE" = "closed" ]; then', 2)],
    ["a hand merge called failed after the last call", "AM-7", (() => { const from = "\n" + ind(10, 'if [ "$NOW_MERGED" = "true" ]; then'); assert.equal(shipped.split(from).length, 2); return dropBlock(shipped.split(from).join("\n" + ind(10, 'if [ "$NOW_MERGED" = "by hand" ]; then')), 'if [ "$NOW_MERGED" = "by hand" ]; then', 1); })()],
    ["an empty field shifts the next ones", "AM-7", edit(shipped, "map(if . == null or . == \"\" then \"-\" else tostring end) | @tsv'", 2, `STATE=$(gh api "repos/\${GITHUB_REPOSITORY}/pulls/\${PR}" --jq '[.state, .head.sha, .base.ref, (.merged | tostring), (.merge_commit_sha // ""), (.merged_by.login // "")] | @tsv') || STATE=""`)],
    ["an exit between the loop's two heads", "AM-7", last(shipped, methodsHead, loopHead + ind(12, 'if [ "$attempt" -gt 1 ]; then exit 0; fi') + ind(12, "for method in squash merge; do"))],
    ["the tip judged taken from the event", "AM-7", edit(shipped, "GATE_TIP: ${{ steps.gate.outputs.tip }}", 1, "GATE_TIP: ${{ github.event.workflow_run.head_sha }}")],
    ["the merge base judged taken from the event", "AM-7", edit(shipped, "GATE_MB: ${{ steps.gate.outputs.merge_base }}", 1, "GATE_MB: ${{ github.event.workflow_run.head_sha }}")],
    ["the tip not handed over by the gate", "AM-7", edit(shipped, 'echo "tip=${TIP}" >> "$GITHUB_OUTPUT"', 1, [])],
    ["the tip judged read again before the loop", "AM-7", once(shipped, ciLoop, ind(10, "# post-merge dispatch would use.") + ind(10, 'GATE_TIP=$(gh api "repos/${GITHUB_REPOSITORY}/git/ref/heads/${BASE_REF}" --jq \'.object.sha\')') + loopHead)],
    ["the gate's merge base not held when missing", "AM-7", inBlock(shipped, 'if ! [[ "$MB" =~ ^[0-9a-f]{40,64}$ ]]; then', 1, "exit 0", "true")],
    ["a string left open around the stop", "AM-7", inBlock(shipped, 'if [ "$NOW_MB" != "$GATE_MB" ]; then', 1, "exit 0", ['echo "\\"', "exit 0", 'echo "\\"'])],
    // The range, on copies the checks of the tip were written against.
    ["the range from base.sha", "AM-7", shipped.split("compare/${TIP}...${HEAD_SHA}\"").join("compare/${BASE_SHA}...${HEAD_SHA}\"")],
    ["a listing of 300 files trusted when the counts agree", "AM-7", edit(shipped, 'if [ "$LISTED" -ge 300 ] || [ "$LISTED" != "$CHANGED" ]; then', 1, 'if [ "$LISTED" != "$CHANGED" ]; then')],
    ["a reversed range", "AM-7", once(shipped, "compare/${TIP}...${HEAD_SHA}\"", "compare/${HEAD_SHA}...${TIP}\"")],
    ["the tip re-anchored on the pull request's stored base", "AM-7", once(shipped, `TIP=$(gh api "repos/\${GITHUB_REPOSITORY}/git/ref/heads/\${BASE_REF}" --jq '.object.sha') || TIP=""`, `TIP=$(gh api "repos/\${GITHUB_REPOSITORY}/pulls/\${PR}" --jq '.base.sha') || TIP=""`)],
    ["a second listing that replaces the range", "AM-7", once(shipped, ind(10, `ROWS=$(jq -r '.files[] | @tsv' <<< "$RANGE")`), ind(10, `RANGE=$(gh api "repos/\${GITHUB_REPOSITORY}/compare/\${HEAD_SHA}^...\${HEAD_SHA}" --jq '{base: (.merge_base_commit.sha // ""), total: .total_commits, commits: [], files: [.files[]? | [.filename, (.previous_filename // "")]], changes: []}')`) + ind(10, `ROWS=$(jq -r '.files[] | @tsv' <<< "$RANGE")`))],
    ["the hold of a listing of 300 files without its exit", "AM-7", once(shipped, ind(12, 'echo "merge=false" >> "$GITHUB_OUTPUT"') + ind(12, "exit 0") + ind(10, "fi") + ind(10, "# The merge base the range was listed from: what the merge writes is"), ind(12, 'echo "merge=false" >> "$GITHUB_OUTPUT"') + ind(10, "fi") + ind(10, "# The merge base the range was listed from: what the merge writes is"))],
    // What the merge wrote, judged again.
    ["promote-from-ci without the check", "AM-10", shipped.slice(0, firstCheck) + shipped.slice(slot)],
    ["a step between the merge and the check", "AM-10", once(shipped, checkName + checkIf + ind(8, "env:") + ind(10, "GH_TOKEN: ${{ github.token }}") + ind(10, "PR: ${{ steps.find-pr.outputs.pr }}"), ind(6, "- name: Something else") + ind(8, "run: echo hi") + "\n" + checkName + checkIf + ind(8, "env:") + ind(10, "GH_TOKEN: ${{ github.token }}") + ind(10, "PR: ${{ steps.find-pr.outputs.pr }}"))],
    ["an unnamed step between the merge and the check", "AM-10", once(shipped, checkName + checkIf + ind(8, "env:") + ind(10, "GH_TOKEN: ${{ github.token }}") + ind(10, "PR: ${{ steps.find-pr.outputs.pr }}"), ind(6, "- run: echo hi") + "\n" + checkName + checkIf + ind(8, "env:") + ind(10, "GH_TOKEN: ${{ github.token }}") + ind(10, "PR: ${{ steps.find-pr.outputs.pr }}"))],
    ["the check skipped when a step before it failed", "AM-10", shipped.split(checkName + checkIf).join(checkName + ind(8, "if: steps.merge.outputs.merged == 'true'"))],
    ["a held path only noticed", "AM-10", inBlock(shipped, verdict, 1, "exit 1", "exit 0")],
    ["the held paths left out of the verdict", "AM-10", edit(shipped, verdict, 1, 'if [ "$WROTE_COUNT" -ge 300 ] || [ "$WEAKENED" != "0" ]; then')],
    ["a listing of 300 files trusted", "AM-10", edit(shipped, verdict, 1, 'if [ "$HELD" != "0" ] || [ "$WEAKENED" != "0" ]; then')],
    ["a listing without its files taken as empty", "AM-10", edit(shipped, `if [ -z "$WROTE" ] || [ "$(jq -r '.listed' <<< "$WROTE")" != "array" ]; then`, 1, 'if [ -z "$WROTE" ]; then')],
    ["the listing of a range that is always empty", "AM-10", shipped.split("compare/${PARENT}...${MERGED}\"").join("compare/${PARENT}...${PARENT}\"")],
    ["another selection of weakened files", "AM-10", edit(shipped, "WROTE_SHRUNK=$(jq -r", 1, "WROTE_SHRUNK=$(jq -r '.changes[] | select(.status == \"removed\") | .filename' <<< \"$WROTE\")")],
    ["an unnamed merge commit passes", "AM-10", inBlock(shipped, 'if ! [[ "$MERGED" =~ ^[0-9a-f]{40,64}$ ]]; then', 1, "exit 1", "exit 0")],
    ["a commit read once, without waiting", "AM-10", edit(shipped, "for delay in 0 5 10; do", 2, "for delay in 0; do")],
    ["an early exit 0", "AM-10", shipped.split(checkRun).join(ind(10, "set -euo pipefail") + ind(10, "exit 0") + ind(10, "# The commit the merge created, listed against its first parent: the"))],
    ["a message that leaves", "AM-10", shipped.split(checkRun).join(ind(10, "set -euo pipefail") + ind(10, 'echo "PR #${PR}: nothing to check" && exit 0') + ind(10, "# The commit the merge created, listed against its first parent: the"))],
    ["a message that runs a command", "AM-10", shipped.split(checkRun).join(ind(10, "set -euo pipefail") + ind(10, 'echo "checked: $(true)"') + ind(10, "# The commit the merge created, listed against its first parent: the"))],
    ["a string left open around the verdict's exit", "AM-10", inBlock(shipped, verdict, 1, "exit 1", ['echo "\\"', "exit 1", 'echo "\\"'])],
    ["an expression in a comment of the check", "AM-10", shipped.split(checkRun).join(ind(10, "set -euo pipefail") + ind(10, `# \${{ fromJSON('"x"') }}`) + ind(10, "# The commit the merge created, listed against its first parent: the"))],
    ["an expression in a comment of the merge loop", "AM-10", once(shipped, ciLoop, ind(10, "# post-merge dispatch would use.") + ind(10, `# \${{ fromJSON('"x"') }}`) + loopHead)],
    ["the merge keeps its commit to itself", "AM-10", last(shipped, shaLine, "")],
    ["a second sha written after the hand-over", "AM-10", last(shipped, shaLine, shaLine + ind(16, 'echo "sha=${HEAD_SHA}" >> "$GITHUB_OUTPUT"'))],
    ["a failed check that lets the job go on", "AM-10", once(shipped, checkName + checkIf + ind(8, "env:") + ind(10, "GH_TOKEN: ${{ github.token }}") + ind(10, "PR: ${{ steps.find-pr.outputs.pr }}"), checkName + checkIf + ind(8, "continue-on-error: true") + ind(8, "env:") + ind(10, "GH_TOKEN: ${{ github.token }}") + ind(10, "PR: ${{ steps.find-pr.outputs.pr }}"))],
    ["a job that lets its failures go", "AM-10", edit(shipped, "timeout-minutes: 10", 1, ["timeout-minutes: 10", "continue-on-error: true"])],
    ["a step that sets the next ones' environment", "AM-10", edit(shipped, 'echo "merge_base=${MB}" >> "$GITHUB_OUTPUT"', 1, ['echo "merge_base=${MB}" >> "$GITHUB_OUTPUT"', 'echo "MERGED=${MB}" >> "$GITHUB_ENV"'])],
    // What the text tools would not see as YAML or bash does.
    ["a spaced continue-on-error key", "AM-10", edit(shipped, "timeout-minutes: 10", 1, ["timeout-minutes: 10", "continue-on-error : true"])],
    ["a bare dash step between the merge and the check", "AM-10", once(shipped, checkName + checkIf + ind(8, "env:") + ind(10, "GH_TOKEN: ${{ github.token }}") + ind(10, "PR: ${{ steps.find-pr.outputs.pr }}"), ind(6, "-") + ind(8, "name: Note") + ind(8, "run: echo hi") + "\n" + checkName + checkIf + ind(8, "env:") + ind(10, "GH_TOKEN: ${{ github.token }}") + ind(10, "PR: ${{ steps.find-pr.outputs.pr }}"))],
    ["an anchored run block with an expression", "AM-10", once(once(shipped, ind(10, "GATE_MB: ${{ steps.gate.outputs.merge_base }}") + ind(8, "run: |"), ind(10, "GATE_MB: ${{ steps.gate.outputs.merge_base }}") + ind(8, "run: &m |")), ciLoop, ind(10, "# post-merge dispatch would use.") + ind(10, `# \${{ fromJSON('"x"') }}`) + loopHead)],
    ["a run block opened after two spaces, with an expression", "AM-10", once(once(shipped, ind(10, "GATE_MB: ${{ steps.gate.outputs.merge_base }}") + ind(8, "run: |"), ind(10, "GATE_MB: ${{ steps.gate.outputs.merge_base }}") + ind(8, "run:  |")), ciLoop, ind(10, "# post-merge dispatch would use.") + ind(10, `# \${{ fromJSON('"x"') }}`) + loopHead)],
    ["a run-first step with an expression", "AM-10", once(shipped, cleanup, ind(6, "- run: |") + ind(10, `# \${{ fromJSON('"x"') }}`) + ind(10, "echo hi") + ind(8, "name: Note") + "\n" + cleanup)],
    ["BASH_ENV in a job's env", "AM-10", edit(shipped, "timeout-minutes: 10", 1, ["timeout-minutes: 10", "env:", "  BASH_ENV: /tmp/x"])],
    ["a merge call spelled apart", "AM-10", edit(shipped, 'gh pr ready "$PR" || echo "::warning::PR #${PR}: could not mark it ready — lift draft by hand."', 1, ['gh pr ready "$PR" || echo "::warning::PR #${PR}: could not mark it ready — lift draft by hand."', 'gh api --method PUT "repos/${GITHUB_REPOSITORY}/pulls/${PR}/mer""ge" -f merge_method=squash -f sha="$HEAD_SHA" > /dev/null || true'])],
    ["a merge path continued on the next line", "AM-10", edit(shipped, 'gh pr ready "$PR" || echo "::warning::PR #${PR}: could not mark it ready — lift draft by hand."', 1, ['gh pr ready "$PR" || echo "::warning::PR #${PR}: could not mark it ready — lift draft by hand."', 'gh api --method PUT "repos/${GITHUB_REPOSITORY}/pulls/${PR}/mer\\', 'ge" -f merge_method=squash -f sha="$HEAD_SHA" > /dev/null || true'])],
    ["leaving before the hand-over", "AM-10", (() => { const from = ind(16, 'echo "$OUT"') + ind(16, 'echo "merged via ${method}"'); assert.equal(shipped.split(from).length, 2); return shipped.split(from).join(ind(16, 'echo "$OUT"') + ind(16, '[ -n "$OUT" ] && exit 0') + ind(16, 'echo "merged via ${method}"')); })()],
    ["merged=false written after the hand-over", "AM-10", last(shipped, shaLine, shaLine + ind(16, 'echo "merged=false" >> "$GITHUB_OUTPUT"'))],
    ["a sha written under a split name", "AM-10", last(shipped, shaLine, shaLine + ind(16, 'echo "s""ha=${HEAD_SHA}" >> "$GITHUB_OUTPUT"'))],
    ["a stop on any moved tip", "AM-7", edit(shipped, 'NOW_MB=$(gh api "repos/${GITHUB_REPOSITORY}/compare/${NOW_TIP}...${HEAD_SHA}"', 1, "exit 0")],
    // What follows a failed merge call: only a 409 leaves, a merge commit only when squash is refused as a method.
    ["an exit after the 409 case", "AM-10", every(shipped, on409, 1, on409 + ind(14, "exit 0"))],
    ["any other failure leaves the 409 case", "AM-10", every(shipped, on409, 1, ind(18, "exit 0 ;;") + ind(16, "*) exit 0 ;;") + ind(14, "esac"))],
    ["the 409 case widened to server errors", "AM-10", edit(shipped, '*"(HTTP 409)"*)', 1, '*"(HTTP 409)"*|*"(HTTP 5"*)')],
    ["a merge commit after any failed squash", "AM-10", edit(shipped, '*"Squash merges are not allowed"*) ;;', 1, "*) ;;")],
    ["the squash refusal not told apart", "AM-10", dropBlock(shipped, 'if [ "$method" = squash ]; then', 1)],
    // One definition of each pattern, however its key is spelled: a job's env would shadow the workflow's.
    ["the patterns shadowed by a job, keys double-quoted", "AM-1", edit(shipped, "timeout-minutes: 10", 1, ["timeout-minutes: 10", "env:", `  "CLAUDE_GATE_RE": '^$'`, `  "PROJECT_GATE_RE": '^$'`, `  "TEST_HOLD_RE": '^$'`])],
    ["the patterns shadowed by a job, keys single-quoted", "AM-1", edit(shipped, "timeout-minutes: 10", 1, ["timeout-minutes: 10", "env:", `  'CLAUDE_GATE_RE': '^$'`, `  'PROJECT_GATE_RE': '^$'`, `  'TEST_HOLD_RE': '^$'`])],
    ["the patterns shadowed by a job, keys spaced", "AM-1", edit(shipped, "timeout-minutes: 10", 1, ["timeout-minutes: 10", "env:", "  CLAUDE_GATE_RE : '^$'", "  PROJECT_GATE_RE : '^$'", "  TEST_HOLD_RE : '^$'"])],
    ["the patterns shadowed by a job, in a flow mapping", "AM-1", edit(shipped, "timeout-minutes: 10", 1, ["timeout-minutes: 10", "env: { CLAUDE_GATE_RE: '^$', PROJECT_GATE_RE: '^$', TEST_HOLD_RE: '^$' }"])],
    ["the test pattern shadowed by a job, key single-quoted", "AM-8", edit(shipped, "timeout-minutes: 10", 1, ["timeout-minutes: 10", "env:", `  'TEST_HOLD_RE': '^$'`])],
    ["the pattern shadowed in the gate step's env, key quoted", "AM-1", once(shipped, gateEnv, gateEnv + ind(10, `"CLAUDE_GATE_RE": '^$'`))],
    // …wherever YAML can start a key, its `:` on the line or the next one.
    ["the patterns shadowed by a job, explicit keys in a flow mapping, `:` on the next line", "AM-1", jobEnv("env: { ? CLAUDE_GATE_RE", "  : '^$', ? PROJECT_GATE_RE", "  : '^$', ? TEST_HOLD_RE", "  : '^$' }")],
    ["the patterns shadowed by a job, keys in a flow mapping, `:` on the next line", "AM-1", jobEnv("env: { CLAUDE_GATE_RE", "  : '^$', PROJECT_GATE_RE", "  : '^$', TEST_HOLD_RE", "  : '^$' }")],
    ["the test pattern shadowed by a job, a comment before its `:`", "AM-8", jobEnv("env: {", "  TEST_HOLD_RE # note", "  : '^$' }")],
    ["the patterns shadowed by a job, keys after `$,` in a flow mapping", "AM-1", jobEnv("env: { A: $,CLAUDE_GATE_RE: '^$', B: $,PROJECT_GATE_RE: '^$', C: $,TEST_HOLD_RE: '^$' }")],
    // A tab would cut a line short for the text tools.
    ["a tab hides the end of a line of the check", "AM-10", edit(shipped, verdict, 1, `${verdict}\ttrue; fi; if false; then`)],
    ["a step opened by a dash and a tab between the merge and the check", "AM-10", every(shipped, checkName, 1, ind(6, "-\tname: Note") + ind(8, "run: echo hi") + "\n" + checkName)],
    // A ${{ }} outside an if's value stays refused next to the `- if:` a step may open with.
    ["an expression in a run line that opens a step", "AM-10", once(shipped, cleanup, ind(6, '- run: echo "${{ github.head_ref }}"') + "\n" + cleanup)],
    ["an expression in a folded if", "AM-10", once(shipped, cleanup, ind(6, "- name: Note") + ind(8, "if: >-") + ind(10, "${{ !cancelled() }}") + ind(8, "run: echo hi") + "\n" + cleanup)],
    // The CI workflow's name is read as a neutral word on its own three lines only.
    ["a refused word on a second line in the shape of the CI name's", "AM-10", once(shipped, cleanup, ind(6, "- name: Note") + ind(8, "env:") + ind(10, "CI_NAME: 'x BASH_ENV'") + ind(8, "run: |") + ind(10, "set -- $CI_NAME") + ind(10, `printf 'def select(f): empty;\\n' > "$HOME/$2"`) + "\n" + cleanup)],
    ["a refused word on a second line in the shape of the CI name's, the real line respelled", "AM-10", once(once(shipped, "CI_NAME: 'CI'", 'CI_NAME: "CI"'), cleanup, ind(6, "- name: Note") + ind(8, "env:") + ind(10, "CI_NAME: 'x BASH_ENV'") + ind(8, "run: |") + ind(10, "set -- $CI_NAME") + ind(10, `printf 'def select(f): empty;\\n' > "$HOME/$2"`) + "\n" + cleanup)],
    ["a refused word on a second comment in the shape of the CI name's", "AM-10", edit(sudoers, "# CI: every run of a workflow named sudoers lint for this commit", 1, ["# CI: every run of a workflow named sudoers lint for this commit", "# CI: every run of a workflow named x BASH_ENV for this commit"])],
    // Every merge waits for CI: no other trigger, however it is written.
    ["a pull_request trigger added back, as the docs fast path had", "AM-11", once(shipped, "    types: [completed]\n", "    types: [completed]\n  pull_request:\n    paths: ['docs/**', '**.md']\n")],
    ["a manual trigger next to workflow_run", "AM-11", once(shipped, "    types: [completed]\n", "    types: [completed]\n  workflow_dispatch:\n")],
    ["the triggers in a flow form", "AM-11", once(shipped, "    types: [completed]\n", "    types: [completed]\n  pull_request_target: {}\n")],
    ["the merge call taken out", "AM-11", every(shipped, 'pulls/${PR}/merge"', 1, 'pulls/${PR}"')],
    ["a second on: key", "AM-11", once(shipped, "\npermissions: {}\n", "\n\"on\": [pull_request]\npermissions: {}\n")],
  ];
  // The project's own patterns may name anything, a jq script or a sudoers file included.
  const widened = shipped
    .replace(/^  PROJECT_GATE_RE: '.*'$/m, () => "  PROJECT_GATE_RE: '^tools/filter\\.jq$|(^|/)sudoers$'");
  assert.notEqual(widened, shipped);
  assert.ok(widened.includes("filter\\.jq"), "PROJECT_GATE_RE replaced");
  const greens = [
    ["as shipped", undefined],
    ["the project's own patterns naming a .jq file and sudoers", widened],
    ["a comment among the triggers", once(shipped, "    types: [completed]\n", "    types: [completed]\n  # The review's end starts it too.\n")],
    ["the dispatch of § After the merge, written the usual ways", dispatch],
    ["a dispatch retried in the merge loop's words, with a message, a JSON body and a jq key of its own", retried],
    ...named.map(([name, text]) => [`rendered with a CI workflow named '${name}'`, text]),
  ];
  const results = await bounded([...greens.map(([label, text]) => () => guard(label, text)), ...cases.map(([label, , text]) => () => guard(label, text))]);
  for (const r of results.slice(0, greens.length)) assert.equal(r.status, 0, `${r.label}: the guard must pass\n${r.stdout}\n${r.stderr}`);
  for (const [i, r] of results.slice(greens.length).entries()) {
    assert.equal(r.status, 1, `${r.label}: the guard must fail\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, new RegExp(`FAIL\\s+${cases[i][1]}:`), `${r.label}\n${r.stdout}\n${r.stderr}`);
  }
});

// ---- auto-merge's merge steps, replayed on git histories ----------------------------------------------------------
// AM-7 and AM-8 read the workflow's text. These replays run its steps, as bash runs them on a runner, against a
// stand-in for the API that answers from a scratch git repository (test/auto-merge-fake-gh.mjs), and look at what
// they decide: the gate's `merge` output, whether the merge call is made, and whether the check of what the merge
// wrote ends red. Each history runs twice, with the pull request's `changed_files` counted from its stored base and
// from the tip. jq is called by the steps themselves: without it, nothing to run, as for AM-8.
const REPLAY = {
  gate: "Merge gate (Claude config, Dependabot breaking bumps and Action minors)",
  merge: "Squash-merge",
  check: "Check what the merge wrote",
};
const FAKE_GH = path.join(KIT_ROOT, "test", "auto-merge-fake-gh.mjs");

// A step of the rendered workflow: its env (name → value as written) and its run block, dedented.
function workflowStep(text, name) {
  const lines = text.split("\n");
  const start = lines.indexOf(`      - name: ${name}`);
  assert.ok(start >= 0, `the workflow has no step "${name}"`);
  let end = start + 1;
  while (end < lines.length && !/^ {0,6}\S/.test(lines[end])) end++;
  const step = lines.slice(start + 1, end);
  const env = {};
  const envAt = step.indexOf("        env:");
  if (envAt >= 0) for (const l of step.slice(envAt + 1)) { const kv = /^ {10}([A-Z_]+): (.*)$/.exec(l); if (!kv) break; env[kv[1]] = kv[2]; }
  const condition = step.find((l) => l.startsWith("        if: "))?.slice(12) ?? null;
  const runAt = step.indexOf("        run: |");
  assert.ok(runAt >= 0, `step "${name}" has no run block`);
  const body = [];
  for (const l of step.slice(runAt + 1)) { if (l.trim() && !l.startsWith(" ".repeat(10))) break; body.push(l.slice(10)); }
  return { env, condition, script: `${body.join("\n")}\n` };
}

// The workflow-level env: the patterns, single-quoted YAML scalars.
function workflowEnv(text) {
  const env = {};
  for (const m of text.matchAll(/^  ([A-Z_]+): '((?:[^']|'')*)'$/gm)) env[m[1]] = m[2].replaceAll("''", "'");
  return env;
}

// A scratch history. Every commit gets its own date, a minute after the last one, unless one is given.
function history() {
  const dir = tmp("auto-merge-replay-");
  let minute = 0;
  const g = (args, date) => {
    const when = date ?? new Date(Date.UTC(2026, 0, 1, 0, ++minute)).toISOString();
    const r = run(dir, "git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], { env: { ...ENV, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } });
    assert.equal(r.status, 0, `git ${args.join(" ")}\n${output(r)}`);
    return r.stdout.trim();
  };
  const h = {
    dir,
    put: (files) => { for (const [rel, text] of Object.entries(files)) { if (text === null) fs.rmSync(path.join(dir, rel)); else write(dir, rel, text); } },
    commit: (message, files = {}, date) => { h.put(files); g(["add", "-A"]); g(["commit", "-q", "--allow-empty", "-m", message], date); return g(["rev-parse", "HEAD"]); },
    branch: (name, from = "main") => g(["switch", "-q", "-c", name, from]),
    on: (name) => g(["switch", "-q", name]),
    merge: (name, date) => { g(["merge", "-q", "--no-ff", "-m", `merge ${name}`, name], date); return g(["rev-parse", "HEAD"]); },
    sha: (rev) => g(["rev-parse", rev]),
    ref: (name, rev) => g(["branch", name, rev]),
  };
  g(["init", "-q", "-b", "main"]);
  return h;
}

// The start of every history: a held settings file, a convention page, ordinary sources.
const seed = (h) => h.commit("M0", { ".claude/settings.json": "S0\n", "docs/conventions/page.md": "P0\n", "CLAUDE.md": "rules\n", "src/a.txt": "a\n", "src/b.txt": "b\n", "src/c.txt": "c\n", "tests/a.test.txt": "t1\nt2\n", "tools/deploy.sh": "d\n" });
// One commit on a branch off main: the usual pull request.
const onBranch = (files) => { const h = history(); const base = seed(h); h.branch("h"); const head = h.commit("h", files); return { h, base, head }; };
const many = (n, dir) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${dir}/f${String(i + 1).padStart(3, "0")}.txt`, `${i}\n`]));

// The history of a branch that landed while the head, which had merged it, set a held path back.
function setBack(heldPath, before, after) {
  const h = history();
  const base = seed(h);
  h.branch("y"); h.commit("y: a held file changed, merged by hand", { [heldPath]: after });
  h.branch("h", "main"); h.merge("y"); const head = h.commit("h: the held file set back", { [heldPath]: before, "src/a.txt": "a2\n" });
  h.on("main"); h.merge("y");
  return { h, base, head };
}

// A criss-cross: the head and the tip have two merge bases, y1 and y2; y2 changed a held path, merged by hand, and
// the head sets it back. git takes one of the two bases for a three-dot listing, by committer date, while the merge
// starts from a virtual base built from both.
function crissCross(y2Later) {
  const h = history();
  const base = seed(h);
  const [early, late] = ["2026-03-01T10:00:00Z", "2026-03-02T10:00:00Z"];
  h.branch("y2"); h.commit("y2: a held file changed, merged by hand", { ".claude/settings.json": "S1\n" }, y2Later ? late : early);
  h.branch("y1", "main"); h.commit("y1: harmless", { "src/b.txt": "b2\n", "src/c.txt": "c2\n" }, y2Later ? early : late);
  h.branch("h", "main"); h.merge("y2", "2026-03-03T10:00:00Z"); h.merge("y1", "2026-03-03T11:00:00Z");
  const head = h.commit("h: the held file set back", { ".claude/settings.json": "S0\n", "src/a.txt": "a2\n", "src/c.txt": "c\n" }, "2026-03-03T12:00:00Z");
  h.on("main"); h.merge("y2", "2026-03-04T10:00:00Z"); h.merge("y1", "2026-03-04T11:00:00Z");
  return { h, base, head };
}

// gate: the gate's `merge` output ("" when it wrote none); called: a merge call was made; check: the exit status of
// the check of what the merge wrote (null when it does not run). An expectation may differ with the way the pull
// request's files are counted: { stored, tip }. Each history: { h, base, head, validated?, between? }, `between`
// moving the base branch after the gate and before the merge step. The replays render the workflow with
// TEST_HOLD_RE = (^|/)tests/ and PROJECT_GATE_RE = ^tools/deploy\.sh$.
const SCENARIOS = [
  ["an ordinary pull request whose base moved on", { gate: "true", called: true, check: 0 }, () => {
    const h = history(); const base = seed(h);
    h.branch("h"); const head = h.commit("h: a source change", { "src/a.txt": "a2\n" });
    h.on("main"); h.commit("main moves on", { "src/b.txt": "b2\n" });
    return { h, base, head };
  }],
  ["a branch the head had merged landed since, and the head sets a held path back", { gate: "false", called: false, check: null }, () => setBack(".claude/settings.json", "S0\n", "S1\n")],
  ["a documentation-only pull request that sets a convention page back", { gate: "false", called: false, check: null }, () => setBack("docs/conventions/page.md", "P0\n", "P1\n")],
  ["a stacked pull request whose lower branch, with a held change, landed with a merge commit", { gate: "true", called: true, check: 0 }, () => {
    const h = history(); seed(h);
    h.branch("lower"); const base = h.commit("lower: a held change, merged by hand", { ".claude/settings.json": "S1\n", "src/l.txt": "l\n" });
    h.branch("upper"); const head = h.commit("upper: a source change", { "src/u.txt": "u\n" });
    h.on("main"); h.merge("lower");
    return { h, base, head };
  }],
  ["a held path renamed away", { gate: "false", called: false, check: null }, () => {
    const h = history(); const base = seed(h);
    h.branch("h"); const head = h.commit("h: a rename out of a held path", { "CLAUDE.md": null, "docs/legacy.md": "rules\n" });
    return { h, base, head };
  }],
  // The count is the only thing that holds: the head merged a branch that landed since, nothing held in either.
  // From the stored base the pull request counts that branch's file too, and the gap holds it; from the tip, the
  // counts agree and it merges.
  ["a branch the head had merged landed since, nothing held", { stored: { gate: "false", called: false, check: null }, tip: { gate: "true", called: true, check: 0 } }, () => {
    const h = history(); const base = seed(h);
    h.branch("y"); h.commit("y: a source file", { "src/y.txt": "y\n" });
    h.branch("h", "main"); h.merge("y"); const head = h.commit("h: a source change", { "src/a.txt": "a2\n" });
    h.on("main"); h.merge("y");
    return { h, base, head };
  }],
  ["a test that only gains lines", { gate: "true", called: true, check: 0 }, () => onBranch({ "tests/a.test.txt": "t1\nt2\nt3\n" })],
  ["a test line rewritten", { gate: "false", called: false, check: null }, () => onBranch({ "tests/a.test.txt": "t1\nt2 weaker\n" })],
  ["a test deleted", { gate: "false", called: false, check: null }, () => onBranch({ "tests/a.test.txt": null })],
  ["a test renamed, unchanged", { gate: "false", called: false, check: null }, () => onBranch({ "tests/a.test.txt": null, "tests/b.test.txt": "t1\nt2\n" })],
  ["a path of PROJECT_GATE_RE changed", { gate: "false", called: false, check: null }, () => onBranch({ "tools/deploy.sh": "d2\n" })],
  // The merge step reads the tip again before its call: an unrelated landing changes nothing, a commit of the head
  // landed meanwhile moves the merge base and stops it.
  ["the base branch moved on between the gate and the merge", { gate: "true", called: true, check: 0 }, () => {
    const h = history(); const base = seed(h);
    h.branch("other"); h.commit("other: a source change", { "src/c.txt": "c2\n" });
    h.branch("h", "main"); const head = h.commit("h: a source change", { "src/a.txt": "a2\n" });
    return { h, base, head, between: (git) => { git(["switch", "-q", "main"]); git(["merge", "-q", "--no-ff", "-m", "other lands", "other"]); } };
  }],
  ["a commit of the head landed between the gate and the merge", { gate: "true", called: false, check: null }, () => {
    const h = history(); const base = seed(h);
    h.branch("h"); const first = h.commit("h: first", { "src/a.txt": "a2\n" }); const head = h.commit("h: second", { "src/b.txt": "b2\n" });
    h.ref("part", first);
    return { h, base, head, between: (git) => { git(["switch", "-q", "main"]); git(["merge", "-q", "--no-ff", "-m", "part lands", "part"]); } };
  }],
  ["a range of 299 files", { gate: "true", called: true, check: 0 }, () => {
    const h = history(); const base = seed(h);
    h.branch("h"); const head = h.commit("h: 299 files", many(299, "gen"));
    return { h, base, head };
  }],
  ["a range of 300 files, none held", { gate: "false", called: false, check: null }, () => {
    const h = history(); const base = seed(h);
    h.branch("h"); const head = h.commit("h: 300 files", many(300, "gen"));
    return { h, base, head };
  }],
  ["a range of 301 files whose last one is held", { gate: "false", called: false, check: null }, () => {
    const h = history(); const base = seed(h);
    h.branch("h"); const head = h.commit("h: 301 files", { ...many(300, "gen"), "zz/CLAUDE.md": "nested rules\n" });
    return { h, base, head };
  }],
  ["a head pushed since the validated commit", { gate: "", called: false, check: null }, () => {
    const h = history(); const base = seed(h);
    h.branch("h"); const validated = h.commit("h: validated", { "src/a.txt": "a2\n" }); const head = h.commit("h: pushed since", { "src/b.txt": "b2\n" });
    return { h, base, head, validated };
  }],
  // Two merge bases. Listed from the one git takes, the held path is seen and held, or missed: then the merge
  // writes it, and the check after the merge turns the run red (docs/conventions/auto-merge-policy.md § Residual risks).
  ["two merge bases, git taking the one that changed the held path", { gate: "false", called: false, check: null }, () => crissCross(true)],
  ["two merge bases, git taking the other one", { gate: "true", called: true, check: 1 }, () => crissCross(false)],
];

async function runStep(step, { cwd, bin, scenarioEnv, context, wfEnv }) {
  const env = { ...ENV, ...wfEnv, ...scenarioEnv, PATH: `${bin}${path.delimiter}${ENV.PATH}`, GITHUB_REPOSITORY: "o/r", GITHUB_OUTPUT: path.join(cwd, "output") };
  delete env.NODE_TEST_CONTEXT;
  for (const [k, v] of Object.entries(step.env)) {
    const expr = /^\$\{\{ (.+) \}\}$/.exec(v)?.[1];
    if (expr === undefined) { env[k] = v.replace(/^'(.*)'$/, "$1"); continue; }
    assert.ok(Object.hasOwn(context, expr), `the replay does not know the step's \${{ ${expr} }} (${k})`);
    env[k] = context[expr];
  }
  fs.writeFileSync(path.join(cwd, "output"), "");
  fs.writeFileSync(path.join(cwd, "step.sh"), step.script);
  const r = await new Promise((resolve) => {
    const child = spawn("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", path.join(cwd, "step.sh")], { cwd, env });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
  const outputs = Object.fromEntries(read(cwd, "output").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  return { status: r.status, log: output(r), outputs };
}

// One history, one way of counting: the gate, then the merge if the gate says so, then the check if it merged.
async function replay(wf, history, count) {
  const cwd = tmp("auto-merge-replay-run-");
  const repo = path.join(cwd, "repo");
  fs.cpSync(history.h.dir, repo, { recursive: true });
  const bin = path.join(cwd, "bin");
  write(bin, "gh", `#!/usr/bin/env bash\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(FAKE_GH)} "$@"\n`, 0o755);
  write(bin, "sleep", "#!/usr/bin/env bash\nexit 0\n", 0o755);
  write(cwd, "state.json", JSON.stringify({ merged: false }));
  const scenarioEnv = { SCEN_REPO: repo, SCEN_HEAD: history.head, SCEN_BASE_SHA: history.base, SCEN_PR_MB: count, SCEN_AUTHOR: "someone", SCEN_STATE: path.join(cwd, "state.json"), SCEN_LOG: path.join(cwd, "calls.log") };
  const steps = Object.fromEntries(Object.entries(REPLAY).map(([k, name]) => [k, workflowStep(wf, name)]));
  const wfEnv = workflowEnv(wf);
  const context = { "github.token": "x", "steps.find-pr.outputs.pr": "7", "steps.event.outputs.head_sha": history.validated ?? history.head, "github.event.repository.default_branch": "main" };
  const at = { cwd, bin, scenarioEnv, context, wfEnv };
  const result = { gate: await runStep(steps.gate, at), merge: null, check: null };
  if (result.gate.outputs.merge === "true") {
    if (history.between) history.between((args) => { const r = run(repo, "git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args]); assert.equal(r.status, 0, output(r)); });
    Object.assign(context, { "steps.gate.outputs.base_ref": result.gate.outputs.base_ref ?? "", "steps.gate.outputs.tip": result.gate.outputs.tip ?? "", "steps.gate.outputs.merge_base": result.gate.outputs.merge_base ?? "" });
    result.merge = await runStep(steps.merge, at);
    if (result.merge.outputs.merged === "true") {
      context["steps.merge.outputs.sha"] = result.merge.outputs.sha ?? "";
      result.check = await runStep(steps.check, at);
    }
  }
  result.called = fs.existsSync(path.join(cwd, "calls.log")) && read(cwd, "calls.log").split("\n").some((l) => l.includes('"PUT"'));
  return result;
}

// The order the replay runs the steps in is the one their conditions give: a change to a condition must change the
// replay with it.
const REPLAY_CONDITIONS = {
  gate: "steps.find-pr.outputs.pr != '' && steps.signoff.outputs.ok == 'true'",
  merge: "steps.find-pr.outputs.pr != '' && steps.gate.outputs.merge == 'true'",
  check: "${{ !cancelled() && steps.merge.outputs.merged == 'true' }}",
};

test("auto-merge: the merge steps, replayed on git histories, hold or merge as the policy says", async (t) => {
  if (!kit.modules.has("auto-merge")) return;
  if (run(KIT_ROOT, "jq", ["--version"]).status !== 0) { t.skip("jq is not installed: the steps call it"); return; }
  const dir = tmp();
  install(dir, ["auto-merge"], { given: { PROJECT_NAME: "demo-app", TEST_HOLD_RE: "(^|/)tests/", PROJECT_GATE_RE: "^tools/deploy\\.sh$" } });
  const wf = read(dir, ".github/workflows/auto-merge.yml");
  assert.doesNotMatch(wf, /__HARNESS_/, "the workflow is rendered");
  for (const [k, name] of Object.entries(REPLAY)) assert.equal(workflowStep(wf, name).condition, REPLAY_CONDITIONS[k], `the condition of "${name}" changed: update the replay`);
  const runs = SCENARIOS.flatMap(([label, expected, build]) => { const h = build(); return ["stored", "tip"].map((count) => ({ label, expected, h, count })); });
  const results = await Promise.all(runs.map(({ h, count }) => replay(wf, h, count)));
  const wrong = [];
  for (const [i, { label, expected, count }] of runs.entries()) {
    const r = results[i];
    const where = `${label} (changed_files from the ${count === "stored" ? "stored base" : "tip"})`;
    const want = expected.stored ? expected[count] : expected;
    const seen = { gate: r.gate.outputs.merge ?? "", called: r.called, check: r.check?.status ?? null };
    const logs = [r.gate, r.merge, r.check].filter(Boolean).map((s) => s.log).join("\n----\n");
    const failed = r.gate.status !== 0 ? "the gate failed" : r.merge && r.merge.status !== 0 ? "the merge step failed" : null;
    if (failed || JSON.stringify(seen) !== JSON.stringify(want)) wrong.push(`${where}: ${failed ?? `expected ${JSON.stringify(want)}, saw ${JSON.stringify(seen)}`}\n${logs}`);
  }
  // Every scenario that went wrong, not the first one only: a broken step shows which histories it lets through.
  assert.equal(wrong.length, 0, `${wrong.length} replay(s) went wrong:\n\n${wrong.join("\n\n")}`);
});

// GA-2 runs zizmor from its release archive, checked against a sha256 pinned per platform, kept in a cache for
// --offline runs. No network here: a stand-in archive goes into the cache, and the pins are rewritten to its hash
// where a row needs them to match. The path through the guard is the one the real archive takes.
test("ci-security: GA-2 runs zizmor only from an archive that matches its pinned sha256", (t) => {
  if (!kit.modules.has("ci-security")) return;
  const GUARD = "scripts/guards.d/30-github-actions.sh";
  const pristine = tmp();
  install(pristine, ["ci-security"]);
  const guard = read(pristine, GUARD);
  const PIN = /(echo "[a-z0-9_-]+ )[0-9a-f]{64}"/g;
  const targets = [...guard.matchAll(/echo "([a-z0-9_-]+) [0-9a-f]{64}"/g)].map((m) => m[1]).sort();
  assert.deepEqual(targets, ["aarch64-apple-darwin", "aarch64-unknown-linux-gnu", "x86_64-apple-darwin", "x86_64-unknown-linux-gnu"], "one pin per platform the gate runs on");
  const version = /^ZIZMOR_VERSION=(\S+)$/m.exec(guard)[1];

  // The stand-in says it ran, and exits with ZIZMOR_STAND_IN_RC on an audit.
  const stage = tmp();
  write(stage, "zizmor", '#!/bin/sh\n[ "$1" = --version ] && exit 0\necho "stand-in zizmor ran: $*"\nexit "${ZIZMOR_STAND_IN_RC:-0}"\n', 0o755);
  const archive = path.join(stage, "stand-in.tar.gz");
  assert.equal(run(stage, "tar", ["-czf", archive, "zizmor"]).status, 0, "tar");
  const hash = crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
  const cache = () => {
    const root = tmp("harness-cache-");
    const dir = path.join(root, "harness/zizmor", version);
    fs.mkdirSync(dir, { recursive: true });
    for (const target of targets) fs.copyFileSync(archive, path.join(dir, `zizmor-${target}.tar.gz`));
    return root;
  };
  const project = (pin) => {
    const dir = tmp();
    fs.cpSync(pristine, dir, { recursive: true });
    if (pin) write(dir, GUARD, guard.replace(PIN, `$1${pin}"`));
    assert.equal(run(dir, "git", ["init", "-q", "-b", "main"]).status, 0);
    assert.equal(run(dir, "git", ["add", "-A"]).status, 0);
    return dir;
  };
  const gateIn = (dir, xdg, env = {}) => run(dir, "bash", ["scripts/security-checks.sh", "--offline"], { env: { ...ENV, CI: "", XDG_CACHE_HOME: xdg, ...env } });
  const ran = /stand-in zizmor ran: --offline \.github\/workflows\//;

  let r = gateIn(project(hash), cache());
  assert.equal(r.status, 0, `pins equal to the cached archive: green\n${output(r)}`);
  assert.match(r.stdout, /ok\s+GA-2: zizmor \S+ reports nothing/, output(r));
  assert.match(r.stdout, ran, "the binary unpacked from the archive is the one that ran");

  r = gateIn(project(hash), cache(), { ZIZMOR_STAND_IN_RC: "13" });
  assert.equal(r.status, 1, `zizmor reports findings: red\n${output(r)}`);
  assert.match(r.stderr, /FAIL\s+GA-2: zizmor \S+ reports findings/, output(r));

  // One character changed in the pin, the pin of the kit against a substituted archive: red, never skipped, and
  // nothing from the archive runs. Locally (CI unset), where a missing tool only skips.
  const flipped = (hash[0] === "0" ? "1" : "0") + hash.slice(1);
  for (const [label, pin] of [["one character of the pin changed", flipped], ["the kit's pins, a substituted archive in the cache", null]]) {
    r = gateIn(project(pin), cache());
    assert.equal(r.status, 1, `${label}: red\n${output(r)}`);
    assert.match(r.stderr, /FAIL\s+GA-2: the zizmor \S+ archive for \S+ does not match its pinned sha256/, `${label}\n${output(r)}`);
    assert.doesNotMatch(output(r), /skip\s+GA-2|skipped: 30-github-actions/, `${label}: a mismatch is never a skip`);
    assert.doesNotMatch(r.stdout, ran, `${label}: nothing from the archive runs`);
  }

  // Offline with nothing cached, and a platform with no pin: skipped on a laptop, red on a runner.
  const empty = tmp("harness-cache-");
  const shim = tmp("harness-uname-");
  write(shim, "uname", '#!/bin/sh\ncase "$1" in -s) echo Plan9 ;; -m) echo mips ;; *) PATH=/usr/bin:/bin exec uname "$@" ;; esac\n', 0o755);
  const unpinned = { PATH: `${shim}${path.delimiter}${ENV.PATH}` };
  for (const [label, xdg, env, reason] of [["offline, nothing cached", empty, {}, /not in the local cache/], ["a platform with no pinned archive", cache(), unpinned, /no zizmor \S+ archive is pinned for Plan9\/mips/]]) {
    r = gateIn(project(hash), xdg, env);
    assert.equal(r.status, 0, `${label}, CI unset: skipped\n${output(r)}`);
    assert.match(r.stdout, /skip\s+GA-2: /, `${label}\n${output(r)}`);
    assert.match(output(r), reason, label);
    r = gateIn(project(hash), xdg, { ...env, CI: "true" });
    assert.equal(r.status, 1, `${label}, CI set: red\n${output(r)}`);
    assert.match(r.stderr, /FAIL\s+GA-2: .*mandatory on a CI runner/, `${label}\n${output(r)}`);
  }
  assert.deepEqual(fs.readdirSync(empty), [], "offline, nothing is written to the cache");

  // fetch-pinned-release.sh on a machine without sha256sum (older macOS): shasum -a 256 checks the archive.
  const which = (tool) => run(stage, "bash", ["-c", `command -v ${tool}`]).stdout.trim();
  const shasum = which("shasum");
  if (!shasum) { t.diagnostic("shasum is not installed: the fallback is not exercised"); return; }
  const tools = tmp("harness-tools-");
  if (noWorkingRm(t, linkTools(tools, ["cut", "grep", "mktemp", "rm", "cp", "mkdir", "tar", "gzip", "perl", "shasum"]))) return;
  const bash = which("bash");
  const fetch = (pin) => {
    const dest = tmp();
    const res = run(pristine, bash, ["scripts/fetch-pinned-release.sh", "zizmorcore/zizmor", `v${version}`, `zizmor-${targets[0]}.tar.gz`, pin, "zizmor", dest],
      { env: { PATH: tools, FETCH_PINNED_CACHE: path.join(cache(), "harness/zizmor", version), FETCH_PINNED_OFFLINE: "1" } });
    return { res, unpacked: fs.existsSync(path.join(dest, "zizmor")) };
  };
  let f = fetch(hash);
  assert.equal(f.res.status, 0, `shasum fallback, matching pin\n${f.res.stderr}`);
  assert.ok(f.unpacked, "the member is unpacked");
  f = fetch(flipped);
  assert.equal(f.res.status, 3, `shasum fallback, pin off by one character: exit 3\n${f.res.stderr}`);
  assert.ok(!f.unpacked, "nothing is unpacked");
});

// The review record of a pull request description (RR-1): advisory, skipped when no description is given, and
// red only when REVIEW_RECORD=enforce is set. The description is read from a file or from PR_BODY, never printed.
test("RR-1: a pull request description without a current review record is noted, and refused when enforced", () => {
  const dir = tmp();
  install(dir, []);
  const head = "0123456789abcdef0123456789abcdef01234567";
  const rr = (env) => run(dir, "bash", ["scripts/guards.d/12-review-record.sh"], { env: { ...ENV, PR_BODY_FILE: "", PR_BODY: "", PR_HEAD_SHA: "", REVIEW_RECORD: "", ...env } });
  assert.equal(rr({}).status, 77, "no description given: skipped, so a laptop run stays green");
  const good = `## Summary\n\nx\n\n## Review record\r\n\r\nTier 2. Security pass on ${head.slice(0, 9)}: no findings.\r\n\r\n## Notes\n`;
  const cases = [
    [good, "a record that names the head (CRLF included)"],
  ];
  const bad = [
    ["Nothing here.\n", /no `## Review record` section/, "no section"],
    [`## Review record\n\nTier 2, head fedcba987654.\n`, /does not name the current head/, "a stale head"],
    [`## Review record\n\n## Notes\nhead ${head}\n`, /does not name the current head/, "a head named after the section ended"],
    [`## Review record\n\nhead abc123\n`, /does not name the current head/, "a token under seven characters"],
  ];
  const file = path.join(dir, "pr-body.md");
  for (const [body, why] of cases) {
    fs.writeFileSync(file, body);
    for (const env of [{ PR_BODY_FILE: file, PR_HEAD_SHA: head, REVIEW_RECORD: "enforce" }, { PR_BODY: body, PR_HEAD_SHA: head, REVIEW_RECORD: "enforce" }]) {
      const r = rr(env); assert.equal(r.status, 0, `${why}: ${output(r)}`); assert.match(r.stdout, /RR-1: the review record names the head/);
    }
  }
  for (const [body, re, why] of bad) {
    fs.writeFileSync(file, body);
    let r = rr({ PR_BODY_FILE: file, PR_HEAD_SHA: head });
    assert.equal(r.status, 0, `${why}: advisory by default`); assert.match(r.stdout, re); assert.match(r.stdout, /advisory/);
    r = rr({ PR_BODY_FILE: file, PR_HEAD_SHA: head, REVIEW_RECORD: "enforce" });
    assert.equal(r.status, 1, `${why}: refused when enforced`); assert.match(r.stderr, re);
    assert.doesNotMatch(output(r), /Tier 2|abc123/, "the description is never printed");
    r = rr({ PR_BODY: body, PR_HEAD_SHA: head, REVIEW_RECORD: "enforce" });
    assert.equal(r.status, 1, `${why}: the same from PR_BODY`);
  }
  assert.equal(rr({ PR_HEAD_SHA: head, REVIEW_RECORD: "enforce" }).status, 1, "a pull request with an empty description has no record");
  assert.equal(rr({ PR_BODY_FILE: path.join(dir, "missing.md") }).status, 1, "a named file that does not exist is an error");
  assert.equal(rr({ PR_HEAD_SHA: "zz", PR_BODY: good }).status, 1, "a head that is not a hash is an error");
});
