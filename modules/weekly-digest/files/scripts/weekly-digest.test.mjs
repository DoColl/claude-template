// WD-1 — self-test of scripts/weekly-digest.mjs (run by the gate through
// scripts/guards.d/42-weekly-digest.sh, and so by CI). Pure logic only: no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildDigest, prReason, parseDeadline, safeText, readGateRe, readDocsRe, hasSchedule,
  scheduledWorkflows, loadRules, workflowName, ciWorkflowFile, checkConfig,
  MAX_AGE_DAYS, SELF, DEFAULT_BRANCH, CI_WORKFLOW,
} from './weekly-digest.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// The two declarations the digest reads, written the way auto-merge.yml carries
// them: a workflow-level env entry and the NON_DOCS grep of the docs-only job.
const AUTO_MERGE = [
  'env:',
  '  GH_REPO: ${{ github.repository }}',
  "  CLAUDE_GATE_RE: '(^|/)\\.claude(/|$)|(^|/)claude(\\.local)?\\.md$|^\\.githooks(/|$)|^\\.github/workflows/(auto-merge|claude[^/]*)\\.ya?ml$'",
  'jobs:',
  '  promote-docs:',
  '    steps:',
  '      - run: |',
  "          NON_DOCS=$(grep -E -v -c '(\\.md$|^docs/|^LICENSE$|^\\.gitignore$)' <<< \"$PATHS\" || true)",
  '',
].join('\n');

const gateRe = readGateRe(AUTO_MERGE);
const docsRe = readDocsRe(AUTO_MERGE);
const res = { gateRe, docsRe };
const now = new Date('2030-03-01T06:00:00Z');
const daysAgo = (n) => new Date(now - n * 86400000).toISOString();
const green = { status: 'completed', conclusion: 'success' };
const pr = (o) => ({
  number: 1, title: 't', createdAt: daysAgo(5), author: 'someone', headRef: 'feat/x',
  files: ['src/x.ts'], mergeableState: 'clean', ci: green, updateTypes: [], ...o,
});
const inTmp = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'weekly-digest-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};
const isDocs = (re) => {
  for (const p of ['docs/x.ts', 'README.md', 'LICENSE', '.gitignore', 'CLAUDE.md']) assert.ok(re.test(p), p);
  assert.ok(!re.test('src/x.ts'));
};
const isGate = (re) => {
  assert.ok(re.test('CLAUDE.md'));
  assert.ok(re.test('.claude/agents/x.md'));
  assert.ok(re.test('.github/workflows/claude.yml'));
  assert.ok(!re.test('src/x.ts'));
};

test('scheduled workflows are discovered, overrides name real ones', () => {
  const found = scheduledWorkflows();
  assert.ok(found.includes(SELF), `schedule detection missed ${SELF}`);
  for (const f of Object.keys(MAX_AGE_DAYS)) assert.ok(found.includes(f), `${f} in maxAgeDays (weekly-digest.config.mjs) has no schedule`);
});

test('schedule detection covers every YAML spelling, not comments', () => {
  assert.ok(hasSchedule('on:\n  schedule:\n    - cron: x'));
  assert.ok(hasSchedule('on:\n  schedule: # weekly\n    - cron: x'));
  assert.ok(hasSchedule("on: {schedule: [{cron: '1 * * * *'}]}"));
  assert.ok(hasSchedule("on: {\"schedule\": [{cron: '0 3 * * *'}]}"));
  assert.ok(hasSchedule("on:\n  'schedule':\n    - cron: x"));
  assert.ok(!hasSchedule('on:\n  # schedule: disabled\n  push:'));
  assert.ok(!hasSchedule('on:\n  push: # no schedule: here\n'));
});

test('docs-only set and gate regex are read from auto-merge.yml', () => {
  isDocs(docsRe);
  isGate(gateRe);
});

test('the project\'s PROJECT_GATE_RE is read with the kit\'s pattern', () => {
  // a function as the replacement: a pattern ending in $ followed by a quote would otherwise be read as "$'"
  const withOwn = (re) => AUTO_MERGE.replace('jobs:', () => `  PROJECT_GATE_RE: '${re}'\njobs:`);
  const own = readGateRe(withOwn('^tools/hooks/|^GEMINI\\.md$'));
  isGate(own);
  assert.ok(own.test('tools/hooks/pre-run.sh'));
  assert.ok(own.test('gemini.md'), 'case-insensitive, like the gate');
  assert.ok(!own.test('src/tools/hooks/x.ts'));
  assert.ok(!readGateRe(withOwn('^$')).test('src/x.ts'), 'as shipped, it adds nothing');
});

test('rules: built-in without auto-merge.yml, read from it when installed, loud when it lost a declaration', () => inTmp((dir) => {
  const builtin = loadRules(dir);
  assert.equal(builtin.autoMerge, false);
  isDocs(builtin.docsRe);
  isGate(builtin.gateRe);
  assert.ok(builtin.gateRe.test('.githooks/pre-push'));
  assert.ok(builtin.gateRe.test('packages/api/.mcp.json'));

  writeFileSync(join(dir, 'auto-merge.yml'), AUTO_MERGE);
  const read = loadRules(dir);
  assert.equal(read.autoMerge, true);
  assert.equal(read.gateRe.source, gateRe.source);
  assert.equal(read.docsRe.source, docsRe.source);

  writeFileSync(join(dir, 'auto-merge.yml'), AUTO_MERGE.replace('CLAUDE_GATE_RE', 'GATE'));
  assert.throws(() => loadRules(dir), /CLAUDE_GATE_RE not found/);
  writeFileSync(join(dir, 'auto-merge.yml'), AUTO_MERGE.replace('NON_DOCS', 'DOCS'));
  assert.throws(() => loadRules(dir), /NON_DOCS pattern not found/);
}));

test('the rules of this repository load, from auto-merge.yml if it is installed', () => {
  const rules = loadRules();
  assert.equal(rules.autoMerge, existsSync(join(ROOT, '.github/workflows/auto-merge.yml')));
  assert.ok(rules.gateRe.test('CLAUDE.md'));
  assert.ok(rules.gateRe.test('.claude/agents/x.md'));
  assert.ok(rules.docsRe.test('README.md'));
  assert.ok(rules.docsRe.test('docs/x.md'));
  assert.ok(!rules.gateRe.test('src/x.ts'));
  assert.ok(!rules.docsRe.test('src/x.ts'));
});

test('the CI workflow is found by its name', () => {
  assert.equal(workflowName('name: CI\non: push\n'), 'CI');
  assert.equal(workflowName('# header\nname: CI # the merge gate\n'), 'CI');
  assert.equal(workflowName("name: 'Build and test'\n"), 'Build and test');
  assert.equal(workflowName('name: "CI" # quoted\n'), 'CI');
  assert.equal(workflowName('on: push\njobs:\n  a:\n    name: CI\n'), null, 'a job name is not the workflow name');
  inTmp((dir) => {
    writeFileSync(join(dir, 'build.yaml'), 'name: "Build and test"\non: push\n');
    writeFileSync(join(dir, 'ci.yml'), 'name: CI\non: pull_request\n');
    writeFileSync(join(dir, 'unnamed.yml'), 'on: push\n');
    writeFileSync(join(dir, 'notes.txt'), 'name: CI\n');
    assert.equal(ciWorkflowFile('CI', dir), 'ci.yml');
    assert.equal(ciWorkflowFile('Build and test', dir), 'build.yaml');
    assert.equal(ciWorkflowFile('Deploy', dir), null);
    assert.equal(ciWorkflowFile('CI', join(dir, 'missing')), null);
  });
});

test('settings are checked on import', () => {
  assert.equal(typeof DEFAULT_BRANCH, 'string');
  assert.equal(typeof CI_WORKFLOW, 'string');
  const ok = { defaultBranch: 'main', ciWorkflow: 'CI', maxAgeDays: { 'nightly.yml': 3 } };
  assert.deepEqual(checkConfig(ok), ok);
  assert.deepEqual(checkConfig({ defaultBranch: 'main', ciWorkflow: 'CI' }).maxAgeDays, {});
  assert.throws(() => checkConfig(null), /must export an object/);
  assert.throws(() => checkConfig({ ...ok, defaultBranch: '' }), /defaultBranch/);
  assert.throws(() => checkConfig({ ...ok, ciWorkflow: undefined }), /ciWorkflow/);
  assert.throws(() => checkConfig({ ...ok, maxAgeDays: { 'nightly.yml': '3' } }), /maxAgeDays/);
  assert.throws(() => checkConfig({ ...ok, maxAgeDays: ['nightly.yml'] }), /maxAgeDays/);
});

test('PR reasons', () => {
  assert.equal(prReason(pr({}), res, now), 'CI green but not merged: check `auto-merge.yml`');
  assert.equal(prReason(pr({ createdAt: daysAgo(1) }), res, now), null, 'green and young: not the owner\'s move yet');
  assert.match(prReason(pr({ ci: null }), res, now), /no CI run/);
  assert.equal(prReason(pr({ ci: null, createdAt: new Date(now - 600000).toISOString() }), res, now), null);
  assert.match(prReason(pr({ ci: null, files: ['docs/x.md'] }), res, now), /docs-only/);
  assert.match(prReason(pr({ ci: null, files: ['CLAUDE.md'] }), res, now), /Claude instruction files/, 'no CI by design, hand merge');
  assert.match(prReason(pr({ ci: null, files: ['CLAUDE.md', 'x.ts'] }), res, now), /no CI run/);
  assert.match(prReason(pr({ ci: null, files: ['docs/x.md'], filesComplete: false }), res, now), /no CI run/, 'truncated listing is never docs-only');
  assert.match(prReason(pr({ ci: { status: 'completed', conclusion: 'failure' }, createdAt: daysAgo(0) }), res, now), /failure/);
  assert.match(prReason(pr({ files: ['CLAUDE.md', 'x.ts'] }), res, now), /Claude instruction files/);
  assert.match(prReason(pr({ headRef: 'claude/issue-12' }), res, now), /Claude instruction files/);
  assert.match(prReason(pr({ author: 'dependabot[bot]', updateTypes: ['semver-minor', 'semver-major'] }), res, now), /major: merge by hand/);
  assert.match(prReason(pr({ author: 'dependabot[bot]', updateTypes: ['semver-minor'] }), res, now), /held by `auto-merge.yml`/, 'a minor is merged unless held: point at the run');
  assert.match(prReason(pr({ author: 'dependabot[bot]' }), res, now), /held by `auto-merge.yml`/);
  assert.match(prReason(pr({ files: ['.github/workflows/ci.yml'] }), res, now), /403/);
  assert.match(prReason(pr({ author: 'dependabot[bot]', updateTypes: ['semver-minor'], files: ['.github/workflows/ci.yml'] }), res, now), /Dependabot on `.github\/`/, 'the gate holds Action minors');
  assert.match(prReason(pr({ author: 'dependabot[bot]', updateTypes: ['semver-patch'], files: ['.github/workflows/ci.yml'] }), res, now), /403/, 'an Action patch: gate or 403, the run tells');
  assert.match(prReason(pr({ mergeableState: 'dirty', createdAt: daysAgo(0) }), res, now), /conflicts with/);
});

test('PR reasons without auto-merge.yml: a green PR simply waits for a merge', () => {
  const manual = { ...res, autoMerge: false };
  assert.equal(prReason(pr({}), manual, now), 'CI green, not merged: merge it or close it');
  assert.equal(prReason(pr({ createdAt: daysAgo(1) }), manual, now), null);
  assert.match(prReason(pr({ ci: null, files: ['docs/x.md'] }), manual, now), /docs-only, no CI run expected/);
  assert.match(prReason(pr({ files: ['CLAUDE.md', 'x.ts'] }), manual, now), /Claude instruction files/);
  assert.match(prReason(pr({ ci: null }), manual, now), /no CI run/, 'a missing run is still a missing run');
  assert.match(prReason(pr({ ci: { status: 'completed', conclusion: 'failure' }, createdAt: daysAgo(0) }), manual, now), /failure/);
  for (const o of [{}, { author: 'dependabot[bot]', updateTypes: ['semver-major'] }, { files: ['.github/workflows/ci.yml'] }, { ci: null, files: ['docs/x.md'] }]) {
    assert.doesNotMatch(prReason(pr(o), manual, now), /auto-merge/, 'no pointer to a workflow that is not installed');
  }
});

test('PR reasons without a CI workflow: no run is expected, age and conflicts only', () => {
  const noCi = { ...res, hasCi: false };
  assert.equal(prReason(pr({ ci: null, createdAt: daysAgo(1) }), noCi, now), null);
  assert.match(prReason(pr({ ci: null }), noCi, now), /no CI workflow/);
  assert.match(prReason(pr({ ci: null, files: ['CLAUDE.md', 'x.ts'] }), noCi, now), /Claude instruction files/);
  assert.match(prReason(pr({ ci: null, mergeableState: 'dirty', createdAt: daysAgo(0) }), noCi, now), /conflicts with/);
});

test('deadline parsing', () => {
  assert.equal(parseDeadline('x\nDue: 2030-03-07\n').toISOString().slice(0, 10), '2030-03-07');
  assert.equal(parseDeadline('due:2030-01-02').toISOString().slice(0, 10), '2030-01-02');
  assert.equal(parseDeadline('DUE :  2030-01-02').toISOString().slice(0, 10), '2030-01-02');
  assert.equal(parseDeadline('overdue: 2030-01-02'), null, 'a word that merely ends in "due" is not the marker');
  assert.equal(parseDeadline('Due: soon'), null);
  assert.equal(parseDeadline('nothing'), null);
  assert.equal(parseDeadline(null), null);
});

test('external text never mentions anyone', () => {
  assert.equal(safeText('bump @types/node\nnext'), 'bump @\u200btypes/node next');
  assert.equal(safeText('a\r\nb\rc'), 'a b c');
  assert.equal(safeText('x'.repeat(200)).length, 120);
});

test('digest: empty, then one item per section', () => {
  const base = { now, prs: [], alerts: [], deadlines: [], mainCi: { conclusion: 'success' }, gateRe, docsRe,
    schedules: [{ workflow: 'ci.yml', maxAgeDays: 9, lastRun: { createdAt: daysAgo(4), status: 'completed', conclusion: 'success' } }] };
  assert.equal(buildDigest(base).count, 0);
  assert.match(buildDigest(base).markdown, /nothing waiting/);

  const full = {
    ...base,
    prs: [pr({ number: 11, files: ['CLAUDE.md'] })],
    alerts: [{ number: 12, title: 'old', createdAt: daysAgo(8) }, { number: 13, title: 'new', createdAt: daysAgo(2) }],
    deadlines: [
      { number: 5, title: 'late', body: 'Due: 2030-02-24' },
      { number: 6, title: 'soon', body: 'Due: 2030-03-05' },
      { number: 9, title: 'today', body: 'Due: 2030-03-01' },
      { number: 7, title: 'far', body: 'Due: 2030-06-01' },
      { number: 8, title: 'no date', body: '' },
    ],
    schedules: [
      { workflow: 'ci.yml', maxAgeDays: 9, lastRun: { createdAt: daysAgo(12), status: 'completed', conclusion: 'success', url: 'u' } },
      { workflow: 'security.yml', maxAgeDays: 9, lastRun: { createdAt: daysAgo(1), status: 'completed', conclusion: 'failure', url: 'u' } },
      { workflow: 'cleanup.yml', maxAgeDays: 9, lastRun: null },
    ],
    mainCi: { conclusion: 'failure', url: 'u' },
  };
  const d = buildDigest(full);
  // 1 PR + 4 runs (default branch + 3 schedules) + 1 old alert + 4 deadlines (late, soon, today, undated)
  assert.equal(d.count, 10);
  assert.match(d.markdown, /#9 today — due 2030-03-01/, 'due today is not overdue');
  assert.match(d.markdown, /#11 .*Claude instruction files/);
  assert.doesNotMatch(d.markdown, /#13/);
  assert.doesNotMatch(d.markdown, /#7 /);
  assert.match(d.markdown, /overdue since 2030-02-24/);
  assert.match(d.markdown, /skipped cron/);
  assert.match(d.markdown, /#8 no date — label `deadline` without a `Due: YYYY-MM-DD` line/);
  assert.doesNotMatch(d.markdown, /No workflow named/);

  // Without a CI workflow the digest says what it could not look at; no line is added to the count.
  const blind = buildDigest({ ...full, hasCi: false, mainCi: null });
  assert.match(blind.markdown, /No workflow named/);
  assert.equal(blind.count, 9);
  assert.equal(buildDigest({ ...base, hasCi: false, mainCi: null }).count, 0);
});
