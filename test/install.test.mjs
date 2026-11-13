// node --test test/*.test.mjs — end-to-end: install modules into a scratch project, run its gate, add, update, conflict.
// Needs git and bash. The gate runs offline, and with CI unset so a guard whose tool is missing skips.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { entries as changelogEntries, byHandBetween } from "../lib/changelog.mjs";
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

test("the manifest names the commit of the kit's checkout, and versions agree across the kit", () => {
  const dir = tmp();
  install(dir, []);
  const head = run(KIT_ROOT, "git", ["rev-parse", "HEAD"]).stdout.trim();
  if (head) assert.ok(readManifest(dir).kit.commit.startsWith(head), "the commit installed from");
  assert.equal(readManifest(KIT_ROOT)?.kit.commit, undefined, "the kit's own root records no commit: it cannot name itself");
  assert.equal(loadKit(kitCopy()).commit, undefined, "a copy that is not a checkout has none, whatever repository sits above it");
  assert.equal(JSON.parse(read(KIT_ROOT, "package.json")).version, kit.version);
  assert.match(read(KIT_ROOT, "CHANGELOG.md"), new RegExp(`^## ${kit.version.replaceAll(".", "\\.")}( |$)`, "m"), "the current version has its entry in CHANGELOG.md");
  assert.equal(read(KIT_ROOT, "CHANGELOG.md").match(/^## (\d+\.\d+\.\d+)/m)[1], kit.version, "and it is the first one");
  for (const block of read(KIT_ROOT, "CHANGELOG.md").split(/^(?=## \d)/m).slice(1)) assert.equal((block.match(/^By hand\b/gm) ?? []).length, 1, `CHANGELOG.md: one "By hand" part per entry — a second one is an entry that lost its heading:\n${block.slice(0, 80)}`);
  for (const e of changelogEntries(KIT_ROOT)) assert.notEqual(e.byHand, null, `CHANGELOG.md § ${e.version} has no "By hand" part ("By hand: nothing." when there is none)`);
});

// Seeds never follow the kit: what a version asks to report by hand is in the changelog, and `update` shows it.
test("update lists the By hand steps of the versions it crosses, until the manifest names the new one", () => {
  const root = kitCopy(), dir = tmp();
  for (const rel of ["bin", "lib"]) fs.cpSync(path.join(KIT_ROOT, rel), path.join(root, rel), { recursive: true });
  const version = (v) => fs.writeFileSync(path.join(root, "kit.json"), JSON.stringify({ name: "claude-template", version: v, repository: "example/kit" }));
  version("1.0.0");
  applyPlan(buildPlan({ kit: loadKit(root), target: dir, given: { PROJECT_NAME: "demo-app" } }));
  version("1.2.0");
  write(root, "CHANGELOG.md", "# Changelog\n\n## 1.3.0\n\nNot there yet.\n\nBy hand: a step of the future.\n\n## 1.2.0\n\n- A thing.\n\nBy hand, for an installed project: add the new line\nto the skeleton.\n\n## 1.1.0\n\nBy hand: nothing.\n\n## 1.0.0\n\nBy hand: an old step.\n");
  write(path.join(root, "modules/core/files"), "docs/conventions/new-page.md", "# New\n");
  const up = (...args) => spawnSync(process.execPath, [path.join(root, "bin/harness.mjs"), "update", dir, ...args], { encoding: "utf8", input: "" });
  const check = up("--check"); assert.equal(check.status, 3, output(check));
  assert.match(check.stdout, /BY HAND[^\n]*\(1 version\(s\) crossed[^\n]*\n  1\.2\.0  By hand, for an installed project: add the new line\n +to the skeleton\./);
  assert.doesNotMatch(check.stdout, /old step|of the future|1\.1\.0/, "only the versions after the recorded one, up to the kit's, and only those with a step");
  assert.match(check.stdout, /behind the kit: 1 item/, "a step is not counted as behind");
  assert.match(up().stdout, /BY HAND/, "shown by the update that crosses the version");
  const after = up("--check"); assert.equal(after.status, 0); assert.doesNotMatch(after.stdout, /BY HAND/, "and not once the manifest names it");
  assert.deepEqual(byHandBetween(kitCopy(), "1.0.0", "9.9.9"), [], "a kit without a changelog has no step to show");
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
  assert.match(a.stdout, /MERGE origin\/main NOW: it changed 1 file\(s\) this branch also changes: base\.txt\n/);
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
  assert.match(d.stdout, /what origin\/main changed since the fork touches none of the files this branch changes/);
  assert.match(d.stdout, /\n  feat-a — [^\n]*\n[^\n]*\n      origin\/main changed 1 of its file\(s\) since it forked: it has a merge to do\n      no file in common with this branch\n/);
  write(wt("d"), "other.txt", "mine, not committed\n");
  assert.match(report(wt("d"), "--no-fetch").stdout, /\n  feat-b — [^\n]*\n[^\n]*\n      1 file\(s\) in common with this branch: other\.txt\n      your changes to 1 of them are not committed, and no forecast covers them: other\.txt\n/, "no commit of this branch holds the file: nothing is forecast");
  fs.rmSync(path.join(wt("d"), "other.txt"));

  // --check is what the guard prints: one line when the base is stale on a file of the branch, silence otherwise.
  assert.match(report(wt("a"), "--check").stdout, /^origin\/main, as last fetched, changed 1 file\(s\) this branch also changes \(base\.txt\): merge it before pushing/);
  assert.equal(report(wt("d"), "--check").stdout, "", "nothing to report is silence, never \"up to date\"");
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
  const seen = report(wt("a"), "--no-fetch").stdout;
  assert.match(seen, /\n1 other worktree\(s\) on a detached HEAD: not compared\n/);
  assert.doesNotMatch(seen, /feat-b/);
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
