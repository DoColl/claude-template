// node --test test/*.test.mjs — end-to-end on a real project that already runs the kit: DoColl/factory-test, at the
// commit test/factory-test.json pins. install.test.mjs starts from empty directories; this starts from a project with
// its own seeds, CI workflow and tests, and checks that the kit as it is now updates it, adds to it, and leaves its
// gate and its tests green.
// The project is read from FACTORY_TEST_DIR, else ../factory-test next to the kit, as a git clone holding the pinned
// commit; it is copied with `git archive`, never touched. Where it is missing the tests are skipped with the reason,
// unless CI or FACTORY_TEST_REQUIRED is set: then they fail. Needs git, bash and tar. The gate runs offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { KIT_ROOT } from "../lib/kit.mjs";
import { walk, MANIFEST } from "../lib/install.mjs";

const PIN = JSON.parse(fs.readFileSync(path.join(KIT_ROOT, "test/factory-test.json"), "utf8"));
const SOURCE = path.resolve(process.env.FACTORY_TEST_DIR || path.join(KIT_ROOT, "..", "factory-test"));
const REQUIRED = Boolean(process.env.CI || process.env.FACTORY_TEST_REQUIRED);
// Modules the pinned project does not have, added on top of it. Local ones: no workflow, no network.
const ADDED = ["git-hooks", "session-settings"];

const ENV = process.env;
const run = (cwd, cmd, args, opts = {}) => spawnSync(cmd, args, { cwd, encoding: "utf8", env: ENV, ...opts });
const cli = (...args) => spawnSync(process.execPath, [path.join(KIT_ROOT, "bin/harness.mjs"), ...args], { encoding: "utf8", input: "" });
const output = (r) => `${r.stdout}\n${r.stderr}`;
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

// Why the source cannot be used, or "" when it can.
function unavailable() {
  if (!/^[0-9a-f]{40}$/.test(PIN.commit ?? "")) return `test/factory-test.json: "commit" is not a full SHA`;
  if (!fs.existsSync(SOURCE)) return `${SOURCE} does not exist (clone ${PIN.repository} there, or set FACTORY_TEST_DIR)`;
  if (run(SOURCE, "git", ["cat-file", "-e", `${PIN.commit}^{commit}`]).status !== 0) return `${SOURCE} does not hold ${PIN.commit} (git fetch it)`;
  return "";
}
const reason = unavailable();
const skip = reason && !REQUIRED ? `${PIN.repository} not available: ${reason}` : false;

// A fresh copy of the pinned tree, in a git repository of its own: the gate reads tracked files.
function copy() {
  assert.equal(reason, "", `${PIN.repository} is required here (CI or FACTORY_TEST_REQUIRED): ${reason}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-factory-"));
  const tar = run(SOURCE, "git", ["archive", "--format=tar", PIN.commit], { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 });
  assert.equal(tar.status, 0, `git archive ${PIN.commit}: ${tar.stderr}`);
  assert.equal(run(dir, "tar", ["-x", "-f", "-"], { input: tar.stdout }).status, 0, "tar -x");
  assert.ok(fs.existsSync(path.join(dir, MANIFEST)), `the pinned commit has no ${MANIFEST}: it is not a project that runs the kit`);
  return dir;
}

function gate(dir) {
  if (!fs.existsSync(path.join(dir, ".git"))) assert.equal(run(dir, "git", ["init", "-q", "-b", "main"]).status, 0, "git init");
  assert.equal(run(dir, "git", ["add", "-A"]).status, 0, "git add");
  return run(dir, "bash", ["scripts/security-checks.sh", "--offline"], { env: { ...ENV, CI: "", NODE_TEST_CONTEXT: "child-v8" } });
}

// The project's own tests, as its CI runs them: every test/*.test.mjs, outside this suite's test context.
function projectTests(dir) {
  const files = fs.existsSync(path.join(dir, "test")) ? fs.readdirSync(path.join(dir, "test")).filter((f) => f.endsWith(".test.mjs")).map((f) => `test/${f}`) : [];
  assert.ok(files.length > 0, "the project has test/*.test.mjs files");
  const env = { ...ENV };
  delete env.NODE_TEST_CONTEXT;
  return run(dir, process.execPath, ["--test", ...files], { env });
}

// Every file the project owns (not recorded as a kit file, or recorded as a seed), with its hash.
function projectOwned(dir) {
  const files = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), "utf8")).files ?? {};
  const owned = {};
  for (const rel of walk(dir)) {
    if (rel === MANIFEST || rel.startsWith(".git/")) continue;
    const entry = files[rel];
    if (!entry || entry.seed) owned[rel] = sha(path.join(dir, rel));
  }
  return owned;
}

test(`${PIN.repository}: update to this kit keeps the project's files, its gate and its tests green`, { skip }, () => {
  const dir = copy();
  const before = projectOwned(dir);
  assert.ok(Object.keys(before).length > 0, "the project owns files");

  const update = cli("update", dir);
  assert.equal(update.status, 0, `update:\n${output(update)}`);
  for (const [rel, hash] of Object.entries(before)) {
    assert.ok(fs.existsSync(path.join(dir, rel)), `update removed ${rel}, a file the project owns`);
    assert.equal(sha(path.join(dir, rel)), hash, `update rewrote ${rel}, a file the project owns`);
  }

  const check = cli("update", dir, "--check");
  assert.equal(check.status, 0, `update --check after an update:\n${output(check)}`);
  const again = cli("update", dir);
  assert.equal(again.status, 0, `second update:\n${output(again)}`);
  assert.match(again.stdout, /nothing to write/, `a second update writes nothing:\n${output(again)}`);

  const g = gate(dir);
  assert.equal(g.status, 0, `the project's gate after the update:\n${output(g)}`);
  const t = projectTests(dir);
  assert.equal(t.status, 0, `the project's tests after the update:\n${output(t)}`);
});

test(`${PIN.repository}: add ${ADDED.join(", ")} to it, gate and tests green`, { skip }, () => {
  const dir = copy();
  const update = cli("update", dir);
  assert.equal(update.status, 0, `update:\n${output(update)}`);
  const installed = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), "utf8")).modules;
  for (const id of ADDED) assert.ok(!installed.includes(id), `${PIN.repository} already has ${id}: pick another module to add`);

  const add = cli("add", dir, "--modules", ADDED.join(","));
  assert.equal(add.status, 0, `add:\n${output(add)}`);
  const now = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), "utf8")).modules;
  for (const id of ADDED) assert.ok(now.includes(id), `${id} recorded in ${MANIFEST}`);
  const check = cli("update", dir, "--check");
  assert.equal(check.status, 0, `update --check after add:\n${output(check)}`);

  const g = gate(dir);
  assert.equal(g.status, 0, `the project's gate after add:\n${output(g)}`);
  const t = projectTests(dir);
  assert.equal(t.status, 0, `the project's tests after add:\n${output(t)}`);
});
