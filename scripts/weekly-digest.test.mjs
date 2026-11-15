// WD-1 — self-test of scripts/weekly-digest.mjs (run by the gate through
// scripts/guards.d/42-weekly-digest.sh, and so by CI). Pure logic only: no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildDigest, prReason, parseDeadline, safeText, readGateRe, readTestRe, hasSchedule,
  scheduledWorkflows, loadRules, workflowName, ciWorkflowFile, checkConfig, readCiAlso, ciAlsoRe, loadCiAlso, readCiFilters,
  DEFAULT_DOCS_RE, MAX_AGE_DAYS, SELF, DEFAULT_BRANCH, CI_WORKFLOW,
} from './weekly-digest.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// The declaration the digest reads, written the way auto-merge.yml carries it:
// a workflow-level env entry.
const AUTO_MERGE = [
  'env:',
  '  GH_REPO: ${{ github.repository }}',
  "  CLAUDE_GATE_RE: '(^|/)\\.claude(/|$)|(^|/)claude(\\.local)?\\.md$|^\\.githooks(/|$)|^\\.github/workflows/(auto-merge|claude[^/]*)\\.ya?ml$'",
  'jobs:',
  '  promote-from-ci:',
  '',
].join('\n');

const gateRe = readGateRe(AUTO_MERGE);
const docsRe = new RegExp(DEFAULT_DOCS_RE);
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

test('the docs-only set, and the gate regex read from auto-merge.yml', () => {
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
  assert.equal(read.testRe, null, 'no TEST_HOLD_RE in this workflow');
  assert.equal(builtin.testRe, null);

  writeFileSync(join(dir, 'auto-merge.yml'), AUTO_MERGE.replace('CLAUDE_GATE_RE', 'GATE'));
  assert.throws(() => loadRules(dir), /CLAUDE_GATE_RE not found/);
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

// A CI workflow that skips Markdown and then takes the instruction files back: the shape of the kit's CI skeleton.
const CI_YML = [
  'name: CI',
  'on:',
  '  push:',
  '    branches: [main]',
  "    paths-ignore: ['docs/**', '**.md', 'LICENSE', '.gitignore']",
  '  pull_request:',
  '    branches: [main]',
  '    # the same set, as `paths` with negations: the last lines take',
  '    # the instruction files back',
  '    paths:',
  "      - '**'",
  "      - '!docs/**'",
  "      - '!**.md' # every Markdown file",
  "      - '!LICENSE'",
  "      - '.claude/**'",
  "      - '**/.claude/**'",
  '      - "CLAUDE.md"',
  '      - **/CLAUDE.md',
  'permissions: {}',
  'jobs:',
  '  security:',
  '    uses: ./x.yml',
  '',
].join('\n');

test('the paths CI runs on although they are documentation are read from its pull_request trigger', () => {
  assert.deepEqual(readCiAlso(CI_YML), ['.claude/**', '**/.claude/**', 'CLAUDE.md', '**/CLAUDE.md']);
  const re = ciAlsoRe(readCiAlso(CI_YML));
  for (const p of ['CLAUDE.md', 'packages/api/CLAUDE.md', '.claude/agents/reviewer.md', '.claude/settings.json', 'sub/.claude/skills/x/SKILL.md']) assert.ok(re.test(p), p);
  for (const p of ['README.md', 'docs/x.md', 'docs/CLAUDE.md.txt', 'src/x.ts', 'XCLAUDE.md', 'claude.md', 'a.claude/x.md']) assert.ok(!re.test(p), p);
  // the same list in flow style, and a sequence at the indentation of its key
  assert.deepEqual(readCiAlso("on:\n  pull_request:\n    paths: ['**', '!**.md', 'CLAUDE.md']\n"), ['CLAUDE.md']);
  assert.deepEqual(readCiAlso("on:\n  pull_request:\n    paths:\n    - '**'\n    - '!**.md'\n    - 'CLAUDE.md'\n  push:\n    paths:\n      - 'x/**'\n"), ['CLAUDE.md']);
  // nothing taken back: no exclusion, an exclusion last, paths-ignore, another trigger's list, no pull_request key
  for (const yml of [
    "on:\n  pull_request:\n    paths:\n      - 'src/**'\n      - 'CLAUDE.md'\n",
    "on:\n  pull_request:\n    paths:\n      - '**'\n      - '!**.md'\n",
    "on:\n  pull_request:\n    paths-ignore: ['**.md']\n",
    "on:\n  pull_request:\n    branches: [main]\n  push:\n    paths:\n      - '**'\n      - '!**.md'\n      - 'CLAUDE.md'\n",
    'on: [push, pull_request]\n',
    "on:\n  # pull_request:\n  #   paths: ['**', '!**.md', 'CLAUDE.md']\n  push:\n",
    // positive entries before the only exclusion are the base set, not paths taken back
    "on:\n  pull_request:\n    paths: ['CLAUDE.md', 'packages/**', '!packages/**/CHANGELOG.md']\n",
  ]) assert.deepEqual(readCiAlso(yml), [], yml);
  assert.equal(ciAlsoRe([]), null);
  assert.throws(() => ciAlsoRe(['docs/[a-c]*.md']), /outside what the digest reads/, 'a pattern the digest cannot read is loud, not ignored');
  // Windows line endings and a quoted key read the same
  assert.deepEqual(readCiAlso(CI_YML.replace(/\n/g, '\r\n')), readCiAlso(CI_YML));
  assert.deepEqual(readCiAlso("on:\r\n  pull_request:\r\n    'paths':\r\n      - '**'\r\n      - '!**.md'\r\n      - 'CLAUDE.md'\r\n"), ['CLAUDE.md']);
  // what it cannot read is loud too, never an empty list: GitHub would run CI on CLAUDE.md in each of these
  for (const yml of [
    CI_YML.replace("      - **/CLAUDE.md", "      - **/CLAUDE.md\n      - '!site/**'"), // a later exclusion that does not match the paths taken back
    "on:\n  pull_request:\n    paths: ['**', '!**.md', 'CLAUDE.md', '!docs/**']\n",
    "on:\n  pull_request: {paths: ['**', '!**.md', 'CLAUDE.md']}\n",
    "on: {pull_request: {paths: ['**', '!**.md', 'CLAUDE.md']}}\n",
    "on:\n  pull_request:\n    paths: [\n      '**', '!**.md',\n      'CLAUDE.md']\n",
    "x: &p ['**', '!**.md', 'CLAUDE.md']\non:\n  pull_request:\n    paths: *p\n",
  ]) assert.throws(() => readCiAlso(yml), /ciAlsoRunsOn/, yml);
});

test('the setting, when the project has one, replaces the reading; without a CI workflow there is nothing to read', () => inTmp((dir) => {
  const settings = { ciWorkflow: 'CI' };
  assert.equal(loadCiAlso(dir, settings), null, 'no workflow carries the name');
  writeFileSync(join(dir, 'ci.yml'), CI_YML);
  assert.ok(loadCiAlso(dir, settings).test('CLAUDE.md'));
  const own = loadCiAlso(dir, { ...settings, ciAlsoRunsOn: ['AGENTS.md'] });
  assert.ok(own.test('AGENTS.md')); assert.ok(!own.test('CLAUDE.md'));
  assert.equal(loadCiAlso(dir, { ...settings, ciAlsoRunsOn: [] }), null, 'an empty list says: nothing, whatever the trigger shows');
  writeFileSync(join(dir, 'ci.yml'), CI_YML.replace("'.claude/**'", "'.claude/{agents,skills}/**'"));
  assert.throws(() => loadCiAlso(dir, settings), /ciAlsoRunsOn/);
  assert.ok(loadCiAlso(dir, { ...settings, ciAlsoRunsOn: ['.claude/agents/**', '.claude/skills/**'] }).test('.claude/agents/x.md'), 'the way out WD-1 points to');
}));

test('the CI workflow of this repository, if there is one, can be read', () => {
  const re = loadCiAlso();
  assert.ok(re === null || re instanceof RegExp);
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
  assert.deepEqual(checkConfig({ ...ok, ciAlsoRunsOn: ['.claude/**', '**/CLAUDE.md'] }).ciAlsoRunsOn, ['.claude/**', '**/CLAUDE.md']);
  assert.ok(!('ciAlsoRunsOn' in checkConfig(ok)), 'unset: the trigger of the CI workflow is read');
  for (const bad of ['CLAUDE.md', [''], [3], [undefined], ['a b'], ['docs/[a-c].md'], ['!x']]) assert.throws(() => checkConfig({ ...ok, ciAlsoRunsOn: bad }), /ciAlsoRunsOn/, JSON.stringify(bad));
  // the message names the entry and the way out, so that following it cannot loop back to the same error
  assert.throws(() => checkConfig({ ...ok, ciAlsoRunsOn: ['CLAUDE.md', 'design notes/x.md'] }), /entry "design notes\/x\.md" is outside what the digest reads .* as \*/);
  assert.ok(ciAlsoRe(checkConfig({ ...ok, ciAlsoRunsOn: ['design*notes/x.md'] }).ciAlsoRunsOn).test('design notes/x.md'));
});

test('PR reasons', () => {
  assert.equal(prReason(pr({}), res, now), 'CI green but not merged: check `auto-merge.yml`');
  const held = { ...res, testRe: readTestRe("  TEST_HOLD_RE: '(^|/)tests?/'\n") };
  assert.match(prReason(pr({ files: ['src/x.ts', 'Tests/x.test.ts'] }), held, now), /touches tests \(`TEST_HOLD_RE`\)/, 'a green pull request left open that touches held tests');
  assert.equal(prReason(pr({}), held, now), 'CI green but not merged: check `auto-merge.yml`', 'no test touched: the pattern changes nothing');
  assert.equal(readTestRe("  TEST_HOLD_RE: '^$'\n"), null, 'as shipped, it holds nothing');
  assert.equal(readTestRe('jobs:\n'), null, 'an auto-merge.yml older than the pattern');
  assert.equal(prReason(pr({ createdAt: daysAgo(1) }), res, now), null, 'green and young: not the owner\'s move yet');
  assert.match(prReason(pr({ ci: null }), res, now), /no CI run/);
  assert.equal(prReason(pr({ ci: null, createdAt: new Date(now - 600000).toISOString() }), res, now), null);
  assert.match(prReason(pr({ ci: null, files: ['docs/x.md'] }), res, now), /^docs-only, no CI run: `auto-merge\.yml` waits for one/, 'auto-merge never merges without a CI run, documentation included');
  assert.match(prReason(pr({ ci: null, files: ['CLAUDE.md'] }), res, now), /Claude instruction files/, 'a CI that skips every Markdown file: no run by design, hand merge');
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

// A CI workflow that runs on the instruction files although they are Markdown: a pull request touching only them
// must get a run, so a run that never started is a missing run — not a hand merge that merely waits.
test('PR reasons when CI runs on some documentation paths', () => {
  const also = { ...res, ciAlso: ciAlsoRe(readCiAlso(CI_YML)) };
  assert.match(prReason(pr({ ci: null, files: ['CLAUDE.md'] }), also, now), /no CI run/, 'the run never started');
  assert.match(prReason(pr({ ci: null, files: ['.claude/agents/x.md', 'docs/x.md'] }), also, now), /no CI run/, 'one such file is enough');
  assert.equal(prReason(pr({ ci: null, files: ['CLAUDE.md'], createdAt: new Date(now - 600000).toISOString() }), also, now), null, 'give the run an hour to start');
  assert.match(prReason(pr({ files: ['CLAUDE.md'] }), also, now), /Claude instruction files/, 'green: it waits for its hand merge');
  assert.equal(prReason(pr({ files: ['CLAUDE.md'], createdAt: daysAgo(1) }), also, now), null, 'green and young');
  assert.match(prReason(pr({ ci: { status: 'completed', conclusion: 'failure' }, files: ['CLAUDE.md'] }), also, now), /failure/);
  assert.match(prReason(pr({ ci: null, files: ['docs/x.md'] }), also, now), /docs-only/, 'plain documentation is still skipped by CI');
  assert.match(prReason(pr({ ci: null, files: ['README.md', 'LICENSE'] }), also, now), /docs-only/);
  assert.match(prReason(pr({ ci: null, files: ['CLAUDE.md'] }), { ...also, hasCi: false }, now), /Claude instruction files/, 'no CI workflow: nothing to expect');
  assert.match(prReason(pr({ ci: null, files: ['CLAUDE.md'] }), { ...also, autoMerge: false }, now), /no CI run/, 'with or without auto-merge.yml');
});

// A session at work on its pull request labels it session-active: the pull request is the session's until the label
// comes off — or until nothing has moved on it for two days, when the label may have been left behind.
test('PR reasons: a pull request a session holds with session-active', () => {
  const held = (o) => pr({ labels: ['bug', 'session-active'], draft: true, ...o });
  assert.equal(prReason(held({ updatedAt: daysAgo(1) }), res, now), null, 'a session is at work on it: not the owner\'s move');
  assert.equal(prReason(held({ updatedAt: daysAgo(1), mergeableState: 'dirty', ci: { status: 'completed', conclusion: 'failure' } }), res, now), null, 'its conflict and its red CI are the session\'s to settle');
  assert.equal(prReason(held({ updatedAt: daysAgo(3) }), res, now), 'labelled `session-active`, no activity for 3 d: if no session is at work on it any more, remove the label, then lift the draft once CI is green on it');
  assert.match(prReason(held({ updatedAt: daysAgo(3), draft: false }), res, now), /remove the label$/, 'not a draft: nothing to lift');
  assert.match(prReason(held({ updatedAt: undefined, createdAt: daysAgo(5) }), res, now), /no activity for 5 d/, 'no update time: its age stands in');
  assert.equal(prReason(pr({ labels: ['session-active-old'] }), res, now), prReason(pr({}), res, now), 'another label holds nothing');
  const { markdown, count } = buildDigest({ now, prs: [held({ number: 5, title: 'still held', updatedAt: daysAgo(4) }), held({ number: 6, updatedAt: daysAgo(0) })], alerts: [], deadlines: [], schedules: [], mainCi: null, ...res });
  assert.equal(count, 1, 'the one left behind, not the one a session is at work on');
  assert.match(markdown, /\n- \[ \] #5 still held — labelled `session-active`, no activity for 4 d: [^\n]* \(5 d\)\n/);
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
      // No run yet: listed once the workflow is older than its slack, not before.
      { workflow: 'young.yml', maxAgeDays: 9, lastRun: null, createdAt: daysAgo(2) },
      { workflow: 'slack.yml', maxAgeDays: 9, lastRun: null, createdAt: daysAgo(9) },
      { workflow: 'old.yml', maxAgeDays: 9, lastRun: null, createdAt: daysAgo(10) },
      { workflow: 'nightly.yml', maxAgeDays: 1, lastRun: null, createdAt: daysAgo(2) },
    ],
    mainCi: { conclusion: 'failure', url: 'u' },
  };
  const d = buildDigest(full);
  // 1 PR + 6 runs (default branch + 5 schedules) + 1 old alert + 4 deadlines (late, soon, today, undated)
  assert.equal(d.count, 12);
  assert.match(d.markdown, /`cleanup\.yml`: no scheduled run found/, 'a workflow of unknown age with no run is listed');
  assert.doesNotMatch(d.markdown, /young\.yml|slack\.yml/, 'a workflow within its slack with no run is not listed yet');
  assert.match(d.markdown, /`old\.yml`: no scheduled run found/);
  assert.match(d.markdown, /`nightly\.yml`: no scheduled run found/, 'the slack is the workflow\'s own');
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
  assert.equal(blind.count, 11);
  assert.equal(buildDigest({ ...base, hasCi: false, mainCi: null }).count, 0);
});

test('a CI workflow with no path filter expects a run on every PR, documentation included', () => {
  assert.equal(readCiFilters('on:\n  push:\n    branches: [main]\n  pull_request:\n    types: [opened]\njobs:\n  x:\n    paths: not a trigger\n'), false);
  assert.equal(readCiFilters("on:\n  pull_request:\n    paths-ignore: ['**.md']\n"), true);
  assert.equal(readCiFilters("on:\n  push:\n    paths: ['src/**']\n  pull_request:\n"), true);
  assert.equal(readCiFilters('on: { pull_request: { paths: [x] } }\n'), true, 'a flow mapping is read too');
  assert.equal(readCiFilters('name: x\n'), true, 'no on: key read: the quieter reading');
  const docsPr = pr({ ci: null, files: ['docs/x.md'], createdAt: daysAgo(1) });
  assert.match(prReason(docsPr, { ...res, ciFilters: false }, now), /\*\*no CI run\*\*/, 'no filter: a missing run is reported after 1 h');
  assert.equal(prReason(docsPr, { ...res, ciFilters: true }, now), null, 'a filter: no run expected, and young');
});
