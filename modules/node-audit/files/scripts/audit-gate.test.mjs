// node --test scripts/audit-gate.test.mjs — the audit gate against canned
// `npm audit --json` reports. No network: a fake `npm` first on PATH prints the
// report. What is pinned here is the part that must not rot silently: the gate
// fails closed when npm fails or changes shape, and a derogation is one
// advisory, for one package, until one date, at one severity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const GATE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'audit-gate.mjs');
const FUTURE = new Date(Date.now() + 30 * 86400e3).toISOString().slice(0, 10);

const advisory = (severity, ghsa = 'GHSA-aaaa-bbbb-cccc') => ({
  source: 1, name: 'left-pad', dependency: 'left-pad', title: 'Something bad', url: `https://github.com/advisories/${ghsa}`, severity, range: '<1.2.3',
});
const report = (via, counts = {}) => ({
  auditReportVersion: 2,
  vulnerabilities: via.length ? { 'left-pad': { name: 'left-pad', severity: via[0].severity ?? 'high', via, range: '<1.2.3' } } : {},
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, ...counts } },
});
const entry = (over = {}) => ({ package: 'left-pad', advisory: 'GHSA-aaaa-bbbb-cccc', severity: 'high', review_by: FUTURE, reason: 'no fixed release; build-time only', ...over });

// One run in a throwaway tree: scripts/ (the gate + an allowlist), bin/npm (fake), ws/ (the workspace).
function run({ stdout, npmExit = 1, allow = [], args = ['ws'] }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-gate-'));
  try {
    for (const d of ['scripts', 'bin', 'ws', 'other']) fs.mkdirSync(path.join(root, d));
    fs.copyFileSync(GATE, path.join(root, 'scripts/audit-gate.mjs'));
    fs.writeFileSync(path.join(root, 'scripts/audit-allowlist.json'), JSON.stringify({ allow }));
    fs.writeFileSync(path.join(root, 'npm-output'), typeof stdout === 'string' ? stdout : JSON.stringify(stdout));
    fs.writeFileSync(path.join(root, 'bin/npm'), '#!/bin/sh\ncat "$FAKE_NPM_OUTPUT"\nexit "$FAKE_NPM_EXIT"\n', { mode: 0o755 });
    return spawnSync(process.execPath, ['scripts/audit-gate.mjs', ...args], {
      cwd: root, encoding: 'utf8',
      env: { ...process.env, PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}`, FAKE_NPM_OUTPUT: path.join(root, 'npm-output'), FAKE_NPM_EXIT: String(npmExit) },
    });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('a clean report passes', () => {
  const r = run({ stdout: report([]), npmExit: 0 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /no unlisted high\+ vulnerabilities/);
});

test('an unlisted high advisory blocks and is named', () => {
  const r = run({ stdout: report([advisory('high')], { high: 1 }) });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /left-pad .*GHSA-aaaa-bbbb-cccc.*not allowlisted/);
});

test('below the threshold is not a finding; --level lowers the threshold', () => {
  const moderate = report([advisory('moderate')], { moderate: 1 });
  assert.equal(run({ stdout: moderate }).status, 0);
  assert.equal(run({ stdout: moderate, args: ['ws', '--level=moderate'] }).status, 1);
});

test('an unknown severity ranks as critical', () => {
  assert.equal(run({ stdout: report([advisory('catastrophic')]) }).status, 1);
});

test('a derogation covers one advisory of one package, until its date, at its severity', () => {
  const high = report([advisory('high')], { high: 1 });
  const ok = run({ stdout: high, allow: [entry()] });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /allowlisted: left-pad GHSA-aaaa-bbbb-cccc/);
  assert.equal(run({ stdout: high, allow: [entry({ advisory: 'GHSA-xxxx-yyyy-zzzz' })] }).status, 1, 'another advisory id');
  assert.equal(run({ stdout: high, allow: [entry({ package: 'right-pad' })] }).status, 1, 'another package');
  const expired = run({ stdout: high, allow: [entry({ review_by: '2000-01-01' })] });
  assert.equal(expired.status, 1);
  assert.match(expired.stderr, /derogation expired 2000-01-01/);
  const escalated = run({ stdout: report([advisory('critical')], { critical: 1 }), allow: [entry()] });
  assert.equal(escalated.status, 1);
  assert.match(escalated.stderr, /severity escalated high → critical/);
});

test('a stale entry is reported, not failed', () => {
  const r = run({ stdout: report([]), npmExit: 0, allow: [entry()] });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /stale allowlist entry .*left-pad::GHSA-aaaa-bbbb-cccc/);
});

test('a malformed derogation refuses the whole run', () => {
  for (const bad of [entry({ reason: '' }), entry({ review_by: 'next month' }), entry({ severity: undefined }), entry({ workspace: '' })]) {
    assert.equal(run({ stdout: report([]), npmExit: 0, allow: [bad] }).status, 2, JSON.stringify(bad));
  }
});

test('a workspace-scoped derogation applies to that workspace only', () => {
  const high = report([advisory('high')], { high: 1 });
  assert.equal(run({ stdout: high, allow: [entry({ workspace: 'ws' })] }).status, 0, 'its own workspace');
  assert.equal(run({ stdout: high, allow: [entry({ workspace: './ws/' })] }).status, 0, 'same directory, other spelling');
  assert.equal(run({ stdout: high, allow: [entry({ workspace: 'other' })] }).status, 1, 'a sibling workspace is not covered');
  const sibling = run({ stdout: report([]), npmExit: 0, allow: [entry({ workspace: 'other' })] });
  assert.doesNotMatch(sibling.stdout, /stale/, 'nor reported stale by the sibling run');
  const typo = run({ stdout: high, allow: [entry({ workspace: 'wss' })], args: ['ws', '--workspaces=ws,other'] });
  assert.equal(typo.status, 2);
  assert.match(typo.stderr, /workspace "wss" is not one of: ws, other/);
  assert.equal(run({ stdout: high, allow: [entry({ workspace: 'other' })], args: ['--workspaces=ws,other', 'ws'] }).status, 1, 'flag order does not matter');
});

test('npm failing is never read as "nothing found"', () => {
  assert.equal(run({ stdout: '', npmExit: 1 }).status, 2, 'no output');
  assert.equal(run({ stdout: 'npm ERR! boom', npmExit: 1 }).status, 2, 'not JSON');
  const enolock = run({ stdout: { error: { code: 'ENOLOCK', summary: 'This command requires an existing lockfile.' } } });
  assert.equal(enolock.status, 2);
  assert.match(enolock.stderr, /npm audit failed — This command requires an existing lockfile/);
  assert.equal(run({ stdout: { message: 'request to registry failed' } }).status, 2, 'registry error');
  assert.equal(run({ stdout: { auditReportVersion: 2 }, npmExit: 0 }).status, 2, 'no vulnerabilities key');
});

test('counters without a parsable advisory mean the report shape changed', () => {
  const r = run({ stdout: report([], { high: 2 }) });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /report shape changed/);
  const transitiveOnly = { ...report([advisory('high')], { high: 1 }) };
  transitiveOnly.vulnerabilities['left-pad'].via = ['some-parent'];
  assert.equal(run({ stdout: transitiveOnly }).status, 2);
});

test('without a workspace argument the gate prints its usage', () => {
  const r = run({ stdout: report([]), npmExit: 0, args: [] });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage:/);
});
