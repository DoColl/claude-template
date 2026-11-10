#!/usr/bin/env node
// PL-1 — Claude Code plugins at reviewed commits (docs/conventions/security-review.md).
//
// Compares what Claude Code installed with what was read. The installed side is
// ~/.claude/plugins/installed_plugins.json, field `gitCommitSha`: a file Claude
// Code maintains and does not document, so a format change shows up here as a
// mismatch, never as a silent pass. The reviewed side is
// scripts/reviewed-plugins.json. A local gate only: a CI runner has no plugins,
// so a missing installed file is a skip.
//
// Exit 1 on a retained plugin at another commit than the one recorded, or on a
// rejected plugin being installed. A plugin installed on this machine but absent
// from the registry is reported, not failed: the developer's other plugins are
// not this repository's business. Overrides for the tests: PLUGIN_PINS_INSTALLED,
// PLUGIN_PINS_REGISTRY.
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const registryPath = process.env.PLUGIN_PINS_REGISTRY || join(here, "reviewed-plugins.json");
const installedPath = process.env.PLUGIN_PINS_INSTALLED || join(homedir(), ".claude", "plugins", "installed_plugins.json");
const SHA = /^[0-9a-f]{40}$/;

const registry = JSON.parse(readFileSync(registryPath, "utf8")).plugins ?? {};
let invalid = 0;
for (const [id, entry] of Object.entries(registry)) {
  const ok = entry && (entry.status === "rejected" ? typeof entry.reason === "string" : entry.status === "retained" && SHA.test(entry.reviewed ?? "") && SHA.test(entry.installed ?? ""));
  if (!ok) { console.error(`  PL-1: FAIL — registry entry ${id} needs status "retained" with 40-hex "reviewed" and "installed", or status "rejected" with a "reason"`); invalid++; }
}
if (invalid) process.exit(1);
if (Object.keys(registry).length === 0) {
  console.log("  PL-1: ok — no plugin recorded in scripts/reviewed-plugins.json, nothing to compare");
  process.exit(0);
}
if (!existsSync(installedPath)) {
  console.log(`  PL-1: skip — ${installedPath} not found (CI, or a machine without plugins)`);
  process.exit(0);
}
const installed = JSON.parse(readFileSync(installedPath, "utf8")).plugins ?? {};

let failed = 0;
for (const [id, record] of Object.entries(installed)) {
  const entry = Object.hasOwn(registry, id) ? registry[id] : null;
  const sha = (Array.isArray(record) ? record[0] : record)?.gitCommitSha ?? "(no gitCommitSha)";
  if (!entry) { console.log(`  PL-1: note — ${id} installed but not in reviewed-plugins.json (${sha.slice(0, 7)})`); continue; }
  if (entry.status === "rejected") { console.error(`  PL-1: FAIL — ${id} is installed but rejected: ${entry.reason}`); failed++; continue; }
  if (sha !== entry.installed) {
    console.error(`  PL-1: FAIL — ${id} installed from ${sha.slice(0, 7)}, registry records ${String(entry.installed).slice(0, 7)} (reviewed ${String(entry.reviewed).slice(0, 7)}). Compare the two commits under the plugin's directory, re-read what changed, then update the registry.`);
    failed++; continue;
  }
  console.log(`  PL-1: ok — ${id} at ${sha.slice(0, 7)}`);
}
for (const [id, entry] of Object.entries(registry)) {
  if (entry.status === "retained" && !Object.hasOwn(installed, id)) console.log(`  PL-1: note — ${id} retained but not installed here`);
}
process.exit(failed ? 1 : 0);
