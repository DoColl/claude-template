// node --test scripts/plugin-pins.test.mjs — the outcomes of scripts/plugin-pins.mjs,
// against a fixture registry (the project's own may be empty).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "plugin-pins.mjs");
const A = "a".repeat(40), B = "b".repeat(40);
const REGISTRY = { plugins: {
  "kept@market": { status: "retained", source: "owner/repo", reviewed: A, installed: B, date: "2026-01-01", note: "compare a…b: no file under the plugin's directory" },
  "refused@market": { status: "rejected", reason: "runs a hook on every turn" },
} };

const run = (plugins, registry = REGISTRY) => {
  const dir = mkdtempSync(join(tmpdir(), "plugin-pins-"));
  const reg = join(dir, "reviewed-plugins.json");
  writeFileSync(reg, JSON.stringify(registry));
  const file = plugins === null ? join(dir, "absent.json") : join(dir, "installed_plugins.json");
  if (plugins !== null) writeFileSync(file, JSON.stringify({ version: 2, plugins }));
  const r = spawnSync(process.execPath, [script], { encoding: "utf8", env: { ...process.env, PLUGIN_PINS_INSTALLED: file, PLUGIN_PINS_REGISTRY: reg } });
  return { code: r.status, out: r.stdout + r.stderr };
};

test("no installed_plugins.json: skip with exit 0 (CI)", () => {
  const r = run(null);
  assert.equal(r.code, 0); assert.match(r.out, /skip/);
});
test("retained plugin at the recorded commit: ok, exit 0", () => {
  const r = run({ "kept@market": [{ scope: "user", gitCommitSha: B }] });
  assert.equal(r.code, 0); assert.match(r.out, /ok — kept@market/);
});
test("retained plugin at another commit: FAIL, exit 1", () => {
  const r = run({ "kept@market": [{ scope: "user", gitCommitSha: "0".repeat(40) }] });
  assert.equal(r.code, 1); assert.match(r.out, /FAIL — .*installed from 0000000/);
});
test("a record without gitCommitSha is a mismatch, not a pass", () => {
  const r = run({ "kept@market": [{ scope: "user" }] });
  assert.equal(r.code, 1); assert.match(r.out, /FAIL — /);
});
// One record per scope: the first being right says nothing about the others.
test("every installation record is compared, not only the first", () => {
  let r = run({ "kept@market": [{ scope: "user", gitCommitSha: B }, { scope: "project", gitCommitSha: "0".repeat(40) }] });
  assert.equal(r.code, 1, r.out); assert.match(r.out, /FAIL — kept@market installed from 0000000 \(project scope\) in 1 of its 2 installation records/);
  r = run({ "kept@market": [{ scope: "user", gitCommitSha: B }, { scope: "project" }] });
  assert.equal(r.code, 1, r.out); assert.match(r.out, /FAIL — .*\(no git \(project scope\)/);
  r = run({ "kept@market": [{ scope: "user", gitCommitSha: B }, { scope: "project", gitCommitSha: B }] });
  assert.equal(r.code, 0, r.out); assert.match(r.out, /ok — kept@market at bbbbbbb \(2 installation records\)/);
  r = run({ "refused@market": [{ scope: "user", gitCommitSha: B }, { scope: "local", gitCommitSha: A }] });
  assert.equal(r.code, 1, r.out); assert.match(r.out, /FAIL — .*rejected/);
});
test("an id with no installation record is not installed", () => {
  const r = run({ "kept@market": [], "refused@market": [] });
  assert.equal(r.code, 0, r.out); assert.match(r.out, /note — kept@market retained but not installed here/);
});
test("rejected plugin installed: FAIL, exit 1", () => {
  const r = run({ "refused@market": [{ scope: "user", gitCommitSha: "1".repeat(40) }] });
  assert.equal(r.code, 1); assert.match(r.out, /FAIL — .*rejected/);
});
test("unlisted plugin: note only, exit 0", () => {
  const r = run({ "something-else@other": { scope: "user", gitCommitSha: "2".repeat(40) } });
  assert.equal(r.code, 0); assert.match(r.out, /note — something-else@other installed but not in/);
});
test("empty registry: nothing to compare, the machine's plugins are not listed", () => {
  const r = run({ "something-else@other": { scope: "user", gitCommitSha: "2".repeat(40) } }, { plugins: {} });
  assert.equal(r.code, 0); assert.match(r.out, /nothing to compare/); assert.doesNotMatch(r.out, /something-else/);
});
test("a malformed registry entry fails", () => {
  for (const bad of [{ status: "retained", reviewed: A }, { status: "retained", reviewed: A, installed: "main" }, { status: "rejected" }, { status: "maybe" }]) {
    const r = run({}, { plugins: { "x@y": bad } });
    assert.equal(r.code, 1, JSON.stringify(bad)); assert.match(r.out, /registry entry x@y/);
  }
});
test("the project's registry is well-formed", () => {
  const plugins = JSON.parse(readFileSync(join(here, "reviewed-plugins.json"), "utf8")).plugins;
  assert.equal(typeof plugins, "object");
  const r = spawnSync(process.execPath, [script], { encoding: "utf8", env: { ...process.env, PLUGIN_PINS_INSTALLED: join(tmpdir(), "plugin-pins-absent.json") } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
