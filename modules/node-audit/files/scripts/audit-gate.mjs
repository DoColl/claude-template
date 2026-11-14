#!/usr/bin/env node
// Enforcing audit gate: `npm audit` with an explicit, per-advisory allowlist.
//
// Why this exists instead of a bare `npm audit --audit-level=high`: an
// advisory can be genuinely unfixable (no patched release reachable without
// breaking the build) while still being a real finding worth tracking. The
// bare command leaves only two options — block the pipeline forever, or drop
// the threshold and lose coverage of everything else at that severity. This
// keeps the threshold intact and narrows the exception to a single advisory
// id + package, justified in scripts/audit-allowlist.json.
//
// Usage: node scripts/audit-gate.mjs <workspace-dir> [--level=high] [--workspaces=a,b]
// Exit 0 = clean or fully allowlisted; 1 = unlisted finding at/above level;
// 2 = the audit could not be trusted (npm failed, malformed allowlist).
//
// --workspaces lists every directory the gate is run on (the guard passes it):
// an allowlist entry scoped to a workspace outside that list is a typo that
// would otherwise silently never apply.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const here = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const levelArg = args.find((a) => a.startsWith('--level='));
const level = levelArg ? levelArg.split('=')[1] : 'high';
const workspacesArg = args.find((a) => a.startsWith('--workspaces='));

if (!dir) {
  console.error('usage: node scripts/audit-gate.mjs <workspace-dir> [--level=high] [--workspaces=a,b]');
  process.exit(2);
}

// A workspace is named by its directory as passed to the gate: "." for the
// repository root, "packages/api" otherwise ("./x" and "x/" are the same as "x").
const normalize = (p) => String(p).replace(/^(\.\/)+/, '').replace(/\/+$/, '') || '.';
const known = workspacesArg ? workspacesArg.slice('--workspaces='.length).split(',').filter(Boolean).map(normalize) : null;

const allowlist = JSON.parse(readFileSync(join(here, 'audit-allowlist.json'), 'utf8')).allow ?? [];

// A derogation with no reason or no expiry is not a derogation, it is a
// silent exception — reject the whole run rather than honour a malformed one.
for (const [i, e] of allowlist.entries()) {
  for (const field of ['package', 'advisory', 'severity', 'review_by', 'reason']) {
    if (!e?.[field]) {
      console.error(`✘ audit-allowlist.json entry #${i} is missing "${field}" — refusing to run.`);
      process.exit(2);
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.review_by)) {
    console.error(`✘ audit-allowlist.json entry #${i}: review_by must be YYYY-MM-DD.`);
    process.exit(2);
  }
  if (e.workspace !== undefined && (typeof e.workspace !== 'string' || !e.workspace)) {
    console.error(`✘ audit-allowlist.json entry #${i}: workspace must be a directory name.`);
    process.exit(2);
  }
  if (e.workspace !== undefined && known && !known.includes(normalize(e.workspace))) {
    console.error(`✘ audit-allowlist.json entry #${i}: workspace "${e.workspace}" is not one of: ${known.join(', ')}.`);
    process.exit(2);
  }
}
// The allowlist is one file for every workspace. An entry may name the one
// workspace it applies to: another workspace's run then neither honours it
// (strictly narrower, never wider) nor lists it as stale — the stale line is
// meant to prompt pruning, and printing it on every run for an entry that is
// live in a sibling lockfile would turn that signal into noise.
const workspace = normalize(dir);
const allowed = new Map(
  allowlist
    .filter((e) => !e.workspace || normalize(e.workspace) === workspace)
    .map((e) => [`${e.package}::${e.advisory}`, e]),
);

// `npm audit` exits non-zero whenever anything is found, so the failure is
// carried in stdout, not the exit code — capture it either way.
//
// The scope is pinned explicitly: npm silently implies `--omit=dev` when
// NODE_ENV=production, which would drop the entire dev tree (the bulk of the
// findings this gate exists for) while still printing a green "no
// vulnerabilities". Every dependency type is named, peer included, because an
// `--include` on the command line wins over an `omit` in a workspace's
// .npmrc; and the child env is scrubbed of the knobs that could re-narrow it
// from a shell. What a .npmrc can still change — the registry asked, above
// all — is not scrubbed here: a change to it is reviewed like a change to the
// allowlist.
const childEnv = { ...process.env };
delete childEnv.NODE_ENV;
delete childEnv.npm_config_omit;
delete childEnv.npm_config_production;

let raw;
try {
  raw = execFileSync(
    'npm',
    ['audit', '--json', '--include=prod', '--include=dev', '--include=optional', '--include=peer'],
    {
      cwd: dir,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv,
    },
  );
} catch (err) {
  raw = err.stdout;
  if (!raw) {
    console.error(`✘ ${dir}: npm audit produced no output`);
    console.error(err.stderr ?? err.message);
    process.exit(2);
  }
}

let report;
try {
  report = JSON.parse(raw);
} catch {
  console.error(`✘ ${dir}: npm audit did not print JSON — refusing to pass.`);
  process.exit(2);
}
const threshold = RANK[level] ?? RANK.high;

// npm reports its OWN failures (ENOLOCK, registry unreachable, rate limit) as
// well-formed JSON carrying `error`/`message` and NO `vulnerabilities` key.
// Without these three assertions an infrastructure hiccup reads as "nothing
// found" and the only dependency gate in the enforcing tier goes green.
if (report.error || report.message) {
  const detail = report.message ?? report.error?.summary ?? report.error?.code ?? 'unknown';
  console.error(`✘ ${dir}: npm audit failed — ${detail}`);
  process.exit(2);
}
if (!report.vulnerabilities || typeof report.vulnerabilities !== 'object') {
  console.error(`✘ ${dir}: audit report has no "vulnerabilities" key — refusing to pass.`);
  process.exit(2);
}

// Only `via` entries that are objects are root advisories; string entries just
// name another package that dragged this one in, and would double-count.
const findings = [];
for (const [pkg, node] of Object.entries(report.vulnerabilities ?? {})) {
  for (const via of node.via ?? []) {
    if (typeof via !== 'object') continue;
    // Unknown severity ranks as critical, not 0: if npm ever introduces a new
    // level, the gate must surface it rather than drop it silently.
    if ((RANK[via.severity] ?? RANK.critical) < threshold) continue;
    const id = String(via.url ?? '').split('/').pop() || `source-${via.source}`;
    findings.push({ pkg, id, severity: via.severity, title: via.title, range: via.range });
  }
}

// Cross-check the parsed findings against npm's own counters: if npm says
// there are high/critical nodes but we extracted no root advisory, the report
// shape changed under us and silence would be a false negative, not a pass.
const counts = report.metadata?.vulnerabilities ?? {};
if ((counts.high ?? 0) + (counts.critical ?? 0) > 0 && findings.length === 0) {
  console.error(
    `✘ ${dir}: npm reports ${counts.high ?? 0} high / ${counts.critical ?? 0} critical but no` +
      ` advisory could be parsed — the report shape changed. Refusing to pass.`,
  );
  process.exit(2);
}

const today = new Date().toISOString().slice(0, 10);
const unlisted = [];
const accepted = [];
for (const f of findings) {
  const entry = allowed.get(`${f.pkg}::${f.id}`);
  if (!entry) {
    unlisted.push({ ...f, reason: 'not allowlisted' });
    continue;
  }
  // An expired derogation re-opens the gate. The allowlist promises the
  // exception lasts "only until review_by" — a warning inside an already-green
  // step would not keep that promise.
  if (entry.review_by < today) {
    unlisted.push({ ...f, entry, reason: `derogation expired ${entry.review_by}` });
    continue;
  }
  // Accepted for a given severity, not forever: advisory re-ratings are
  // routine, and a reason written for a build-time DoS must not survive the
  // advisory being re-scored as something worse.
  if ((RANK[f.severity] ?? RANK.critical) > (RANK[entry.severity] ?? -1)) {
    unlisted.push({
      ...f,
      entry,
      reason: `severity escalated ${entry.severity} → ${f.severity} since the derogation`,
    });
    continue;
  }
  accepted.push({ ...f, entry });
}

for (const a of accepted) {
  console.log(
    `  • allowlisted: ${a.pkg} ${a.id} (${a.severity}) — review by ${a.entry.review_by}`,
  );
}

// A stale entry (advisory no longer present) is not a failure, but it should
// not linger silently either — an allowlist nobody prunes stops being read.
const seen = new Set(findings.map((f) => `${f.pkg}::${f.id}`));
for (const key of allowed.keys()) {
  if (!seen.has(key)) console.log(`  • stale allowlist entry (no longer reported): ${key}`);
}

if (unlisted.length === 0) {
  console.log(`  ok ${dir}: no unlisted ${level}+ vulnerabilities (${accepted.length} allowlisted)`);
  process.exit(0);
}

console.error(`\n✘ ${dir}: ${unlisted.length} blocking ${level}+ advisory(ies):`);
for (const f of unlisted) {
  console.error(`    ${f.pkg} ${f.range} — ${f.severity} — ${f.id}  [${f.reason}]`);
  console.error(`      ${f.title}`);
}
console.error(
  `\n  Fix them, or add a justified entry to scripts/audit-allowlist.json` +
    ` (CLAUDE.md § Findings policy — a derogation needs a reason and a review date).`,
);
process.exit(1);
