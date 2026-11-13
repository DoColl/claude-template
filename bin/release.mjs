#!/usr/bin/env node
// release — cut a release of the kit from the changelog fragments under
// changes/: the next version in kit.json and package.json, its entry at the
// top of CHANGELOG.md, the fragments removed, then `node bin/harness.mjs
// update .` for the version the root manifest records. The result goes into a
// pull request of its own, reviewed and merged by hand; .github/workflows/
// release.yml tags the merge. No dependency beyond Node (>= 20), like the
// installer. Exit codes: 0 done (or shown, with --dry-run), 1 nothing to
// release, refused, or failed.
import { parseArgs } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadKit } from "../lib/kit.mjs";
import { FRAGMENTS, readFragments, highestLevel, nextVersion, composeEntry, insertEntry, setVersion } from "../lib/release.mjs";

const USAGE = `release — cut a release of the kit from its changelog fragments

  node bin/release.mjs [--dry-run]

Reads every ${FRAGMENTS}/<slug>.md, takes the highest level among them (patch,
minor, major) and computes the next version. Writes it to kit.json and
package.json, puts the entry at the top of CHANGELOG.md (the fragments' lines,
then one "By hand" part), removes the fragments and runs
\`node bin/harness.mjs update .\` for the root manifest.

  --dry-run   show the version, the entry and what would change; write nothing

Run it on an up-to-date main, in a checkout without uncommitted changes, then
open a pull request with the result. The format of a fragment is described at
the top of CHANGELOG.md.`;

// A reader that closes early (`… | head`) is not an error, as in harness.mjs.
let readerGone = false;
process.stdout.on("error", (e) => { if (e.code !== "EPIPE") throw e; readerGone = true; });
const out = (s = "") => { if (!readerGone) process.stdout.write(`${s}\n`); };

function main(argv) {
  const { values: opt, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { "dry-run": { type: "boolean" }, help: { type: "boolean", short: "h" } } });
  if (opt.help) { out(USAGE); return 0; }
  if (positionals.length) throw new Error(`unexpected argument "${positionals[0]}" (node bin/release.mjs --help)`);
  const dryRun = Boolean(opt["dry-run"]);
  const kit = loadKit();
  const { root } = kit;

  // Everything is computed, and checked, before anything is written.
  const fragments = readFragments(root);
  if (!fragments.length) throw new Error(`nothing to release: ${FRAGMENTS}/ holds no fragment. A pull request that changes the kit adds ${FRAGMENTS}/<slug>.md; the top of CHANGELOG.md gives the format.`);
  const level = highestLevel(fragments);
  const version = nextVersion(kit.version, level);
  const entry = composeEntry(version, fragments);
  const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
  const writes = [
    ["kit.json", setVersion(read("kit.json"), kit.version, version, "kit.json")],
    ["package.json", setVersion(read("package.json"), kit.version, version, "package.json")],
    ["CHANGELOG.md", insertEntry(read("CHANGELOG.md"), entry, kit.version)],
  ];
  // A release holds the fragments as merged, and nothing else: a fragment
  // never committed, or an unrelated edit, would go into it unreviewed.
  const dirty = kit.commit === undefined ? null : kit.commit.endsWith("-dirty");

  const width = Math.max(...fragments.map((f) => f.file.length));
  out(`${kit.name} ${kit.version} → ${version} (${level})${dryRun ? "  (dry run, nothing written)" : ""}`);
  out(`\nfragments (${fragments.length})`);
  for (const f of fragments) out(`  ${f.file.padEnd(width)}  ${f.level}`);
  out("\nthe entry, at the top of CHANGELOG.md:\n");
  out(entry.trimEnd());
  if (dirty === null) out("\nnot a git checkout: nothing tells whether uncommitted changes would go into the release");
  if (dryRun) {
    out(`\nwould write:  ${writes.map(([rel]) => rel).join(", ")}`);
    out(`would remove: ${fragments.map((f) => f.file).join(", ")}`);
    out("would run:    node bin/harness.mjs update .");
    if (dirty) out("\nthe checkout has uncommitted changes: without --dry-run, the release refuses to run");
    return 0;
  }
  if (dirty) throw new Error("the checkout has uncommitted changes: commit or stash them first, so that the release holds the fragments as main has them and nothing else (--dry-run shows the result anyway)");

  for (const [rel, text] of writes) fs.writeFileSync(path.join(root, rel), text);
  for (const f of fragments) fs.rmSync(path.join(root, f.file));
  try { fs.rmdirSync(path.join(root, FRAGMENTS)); } catch { /* something else is left in it: it stays */ }
  out(`\nwritten: ${writes.map(([rel]) => rel).join(", ")}`);
  out(`removed: ${fragments.map((f) => f.file).join(", ")}`);
  out("\n$ node bin/harness.mjs update .");
  const up = spawnSync(process.execPath, [path.join(root, "bin/harness.mjs"), "update", "."], { cwd: root, encoding: "utf8", input: "" });
  if (up.stdout) out(up.stdout.trimEnd());
  if (up.stderr) process.stderr.write(up.stderr);
  if (up.status !== 0) throw new Error(`\`node bin/harness.mjs update .\` exited ${up.status ?? up.signal}: the version, the entry and the removals are written; settle what it reports, then run it again`);
  out(`\nnext: read the diff, commit it alone ("Release ${version}") on a branch of its own and open a pull request. Once merged, .github/workflows/release.yml tags it v${version}.`);
  return 0;
}

try { process.exitCode = main(process.argv.slice(2)); } catch (e) { process.stderr.write(`release: ${e.message}\n`); process.exitCode = 1; }
