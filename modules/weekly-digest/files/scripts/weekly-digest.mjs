#!/usr/bin/env node
// Weekly digest — everything the automated harness is waiting on the owner for,
// gathered into ONE GitHub issue (label `weekly-digest`, assigned to the repo
// owner so GitHub notifies). Run by .github/workflows/weekly-digest.yml.
// Detail and reasons: docs/conventions/weekly-digest.md.
//
// The harness blocks and detects on its own, but some signals only wait for a
// human (hand merges by design, red PRs, untriaged alerts, scheduled runs that
// failed or never fired, overdue follow-ups). Nothing surfaces them otherwise.
//
// Read-only on the repo except for the digest issue itself. Needs a token with
// contents:read, pull-requests:read, actions:read, issues:write.
//
// Usage: node scripts/weekly-digest.mjs [--dry-run]
//   env GITHUB_TOKEN, GITHUB_REPOSITORY (owner/name), optional GITHUB_STEP_SUMMARY.
//   --dry-run prints the digest and writes nothing to GitHub.
// Project settings (default branch, CI workflow, per-workflow slack) live in
// scripts/weekly-digest.config.mjs, which belongs to the project.

import { readFileSync, readdirSync, appendFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from './weekly-digest.config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const isoDay = (d) => d.toISOString().slice(0, 10);

const DIGEST_LABEL = 'weekly-digest';
const DEADLINE_LABEL = 'deadline';
const STALE_PR_HOURS = 48;
const STALE_ALERT_DAYS = 7;
const DEADLINE_SOON_DAYS = 7;

/** The project's settings, checked once: a typo must fail the self-test (WD-1), not a scheduled run. */
export function checkConfig(c) {
  const text = (v) => typeof v === 'string' && v.trim() !== '';
  if (!c || typeof c !== 'object') throw new Error('weekly-digest.config.mjs must export an object');
  if (!text(c.defaultBranch)) throw new Error('weekly-digest.config.mjs: defaultBranch must be a branch name');
  if (!text(c.ciWorkflow)) throw new Error('weekly-digest.config.mjs: ciWorkflow must be the `name:` of the CI workflow');
  const ages = c.maxAgeDays ?? {};
  if (typeof ages !== 'object' || Array.isArray(ages) || Object.values(ages).some((n) => !Number.isInteger(n) || n < 1)) {
    throw new Error('weekly-digest.config.mjs: maxAgeDays maps a workflow file name to a whole number of days');
  }
  return { defaultBranch: c.defaultBranch, ciWorkflow: c.ciWorkflow, maxAgeDays: ages };
}
const SETTINGS = checkConfig(config);
export const DEFAULT_BRANCH = SETTINGS.defaultBranch;
/** The `name:` of the CI workflow; ciWorkflowFile() finds the file the runs API wants. */
export const CI_WORKFLOW = SETTINGS.ciWorkflow;

// How old a scheduled workflow's last scheduled run may get before the digest
// reports it. Every workflow with a `schedule:` is watched (scheduledWorkflows),
// weekly by default; GitHub crons fire hours late or are dropped, hence the slack.
// Workflows that run more often get an entry in the settings' maxAgeDays.
export const DEFAULT_MAX_AGE_DAYS = 9;
export const MAX_AGE_DAYS = SETTINGS.maxAgeDays;
// The digest cannot report on itself: if it stops running, nothing is posted.
// Its absence is the signal (no run of the workflow on its scheduled day).
export const SELF = 'weekly-digest.yml';

// Used only when auto-merge.yml is not installed (loadRules): the paths that
// Claude Code or git EXECUTE rather than read, and the docs-only set a CI
// workflow usually ignores. With auto-merge.yml, its own declarations are read
// instead, so the digest and the merge gate cannot drift.
export const DEFAULT_GATE_RE = '(^|/)\\.claude(/|$)|(^|/)(claude(\\.local)?|agents)\\.md$|^\\.githooks(/|$)|(^|/)\\.mcp\\.json$|(^|/)\\.claude\\.json$|(^|/)\\.ripgreprc$|(^|/)\\.gitmodules$|(^|/)\\.husky(/|$)|^\\.github/workflows/(auto-merge|claude[^/]*)\\.ya?ml$|^\\.github/zizmor\\.ya?ml$|^\\.gitleaks(\\.toml|ignore)$|^scripts/guards\\.d/|^scripts/(security-checks\\.sh|fetch-pinned-release\\.sh|plugin-pins(\\.test)?\\.mjs|reviewed-plugins\\.json|auto-merge-paths\\.txt)$';
export const DEFAULT_DOCS_RE = '(\\.md$|^docs/|^LICENSE$|^\\.gitignore$)';

/**
 * What auto-merge.yml never merges unattended (the AM-1 source of truth):
 * CLAUDE_GATE_RE, the kit's list, joined with PROJECT_GATE_RE, the project's
 * additions, when the workflow declares one.
 */
export function readGateRe(autoMergeYml) {
  const m = autoMergeYml.match(/^ {2}CLAUDE_GATE_RE: '(.*)'$/m);
  if (!m) throw new Error('CLAUDE_GATE_RE not found in auto-merge.yml');
  const own = autoMergeYml.match(/^ {2}PROJECT_GATE_RE: '(.*)'$/m);
  return new RegExp(own ? `(?:${m[1]})|(?:${own[1]})` : m[1], 'i');
}

/** The docs-only path set as auto-merge.yml's NON_DOCS grep defines it (same set as the CI workflow's paths-ignore). */
export function readDocsRe(autoMergeYml) {
  const m = autoMergeYml.match(/NON_DOCS=\$\(grep -E -v -c '([^']+)'/);
  if (!m) throw new Error('NON_DOCS pattern not found in auto-merge.yml');
  return new RegExp(m[1]);
}

/**
 * The tests auto-merge.yml will not let a pull request weaken (TEST_HOLD_RE,
 * AM-8), or null: an auto-merge.yml installed before that pattern existed has
 * none, and `^$`, the shipped value, matches no path.
 */
export function readTestRe(autoMergeYml) {
  const m = autoMergeYml.match(/^ {2}TEST_HOLD_RE: '(.*)'$/m);
  return m && m[1] !== '^$' ? new RegExp(m[1], 'i') : null;
}

/**
 * { gateRe, docsRe, testRe, autoMerge }: read from auto-merge.yml when that
 * workflow is installed (and it throws if the file lost a declaration),
 * built-in otherwise.
 */
export function loadRules(dir = join(ROOT, '.github/workflows')) {
  const file = join(dir, 'auto-merge.yml');
  if (!existsSync(file)) return { gateRe: new RegExp(DEFAULT_GATE_RE, 'i'), docsRe: new RegExp(DEFAULT_DOCS_RE), testRe: null, autoMerge: false };
  const yml = readFileSync(file, 'utf8');
  return { gateRe: readGateRe(yml), docsRe: readDocsRe(yml), testRe: readTestRe(yml), autoMerge: true };
}

/** Workflow files that declare a schedule trigger. */
export function scheduledWorkflows(dir = join(ROOT, '.github/workflows')) {
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .filter((f) => hasSchedule(readFileSync(join(dir, f), 'utf8')));
}

/** Any `schedule:` key outside a comment: block style, trailing comment or flow style. */
export function hasSchedule(yml) {
  return yml
    .split('\n')
    .map((l) => l.replace(/\s#.*$/, ''))
    .some((l) => !/^\s*#/.test(l) && /(^|[\s{,])["']?schedule["']?\s*:/.test(l));
}

/** The top-level `name:` of a workflow, or null when it has none. */
export function workflowName(yml) {
  const m = yml.match(/^name:[ \t]*(.*)$/m);
  if (!m) return null;
  const raw = m[1].trim();
  const quoted = raw.match(/^(['"])(.*?)\1/);
  return (quoted ? quoted[2] : raw.replace(/\s+#.*$/, '').trim()) || null;
}

/** The workflow file whose `name:` is `name` (the runs API is addressed by file), or null. */
export function ciWorkflowFile(name, dir = join(ROOT, '.github/workflows')) {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort();
  return files.find((f) => workflowName(readFileSync(join(dir, f), 'utf8')) === name) ?? null;
}

/**
 * External text (PR / issue titles) goes into an issue body: break @mentions so
 * the digest never pings anyone (`@types/node`), strip line breaks, cap length.
 */
export function safeText(s, max = 120) {
  let t = String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/@/g, '@\u200b'); // zero-width space
  if (t.length > max) t = `${t.slice(0, max - 1)}…`;
  return t;
}

/** `Due: 2030-03-07` (case and spaces tolerant) → Date or null. */
export function parseDeadline(body) {
  const m = String(body ?? '').match(/\bdue\s*:\s*(\d{4}-\d{2}-\d{2})/i);
  if (!m) return null;
  const d = new Date(`${m[1]}T00:00:00Z`); // UTC midnight, compared with today's UTC midnight
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Why an open PR waits on the owner, or null when it is not (yet) the owner's move.
 * `autoMerge`: auto-merge.yml is installed (green PRs are expected to merge on
 * their own). `hasCi`: a CI workflow exists (a run is expected on every PR).
 */
export function prReason(pr, { gateRe, docsRe, testRe = null, autoMerge = true, hasCi = true }, now) {
  const ageH = (now - new Date(pr.createdAt)) / HOUR;
  const { files } = pr;
  // The CI workflow skips docs-only PRs (paths-ignore): no run is expected then.
  // A truncated listing never counts as docs-only. Without a CI workflow, no
  // run is expected at all.
  const ciSkipped = !hasCi || (pr.filesComplete !== false && files.length > 0 && files.every((p) => docsRe.test(p)));
  const gated = files.some((p) => gateRe.test(p)) || pr.headRef.startsWith('claude/issue-');
  const ci = pr.ci; // { status, conclusion } of the latest CI run on the head SHA, or null

  if (pr.mergeableState === 'dirty') return `conflicts with \`${DEFAULT_BRANCH}\`: needs a rebase`;
  if (ci && ci.status !== 'completed') return ageH >= STALE_PR_HOURS ? 'CI has been running for a long time' : null;
  if (ci && ci.conclusion !== 'success') return `CI **${ci.conclusion}**`;
  if (!ci && !ciSkipped) return ageH >= 1 ? '**no CI run** on the latest commit' : null;

  // Green, or no CI by design, from here: only stale PRs are worth a line.
  if (ageH < STALE_PR_HOURS) return null;
  if (gated) return 'merge by hand (Claude instruction files)';
  if (!hasCi) return 'no CI workflow to wait for: merge it or close it';
  // Without auto-merge.yml nothing merges on its own: a green PR simply waits.
  if (!autoMerge) return ci ? 'CI green, not merged: merge it or close it' : 'docs-only, no CI run expected: merge it or close it';
  if (!ci) return 'docs-only and not merged: check `auto-merge.yml`';
  // auto-merge.yml merges Dependabot patch and minor bumps; its verdict holds
  // the rest (its run names why). An Action PR may also have hit the 403: from
  // here only the run tells which.
  const dependabot = pr.author === 'dependabot[bot]';
  if (dependabot && pr.updateTypes.includes('semver-major')) return 'Dependabot major: merge by hand';
  if (dependabot && files.some((p) => p.startsWith('.github/'))) {
    return 'Dependabot on `.github/`: Action minor, held bump or 403 — see the `auto-merge.yml` run, merge by hand';
  }
  if (files.some((p) => p.startsWith('.github/workflows/'))) {
    return 'touches `.github/workflows/`: merge by hand if auto-merge got a 403';
  }
  if (dependabot) return 'Dependabot bump held by `auto-merge.yml` (0.x, unreadable version…): see the run, merge by hand';
  // Only paths are known here, not which lines went: the run says whether AM-8 held it.
  if (testRe && files.some((p) => testRe.test(p))) return 'touches tests (`TEST_HOLD_RE`): held if it deleted or rewrote test lines — see the `auto-merge.yml` run, merge by hand';
  return 'CI green but not merged: check `auto-merge.yml`';
}

/** Pure: data in, { count, markdown } out. */
export function buildDigest({ now, prs, alerts, deadlines, schedules, mainCi, gateRe, docsRe, testRe = null, autoMerge = true, hasCi = true }) {
  const sections = [];
  let count = 0;
  const section = (title, lines) => {
    if (!lines.length) return;
    count += lines.length;
    sections.push(`### ${title} (${lines.length})\n\n${lines.join('\n')}`);
  };
  const item = (n, title, rest) => `- [ ] #${n} ${safeText(title)} ${rest}`;
  const ageD = (d) => Math.floor((now - new Date(d)) / DAY);

  section('Pull requests', prs.flatMap((pr) => {
    const why = prReason(pr, { gateRe, docsRe, testRe, autoMerge, hasCi }, now);
    return why ? [item(pr.number, pr.title, `— ${why} (${ageD(pr.createdAt)} d)`)] : [];
  }));

  const runLines = [];
  if (mainCi?.conclusion && mainCi.conclusion !== 'success') {
    runLines.push(`- [ ] latest CI run on \`${DEFAULT_BRANCH}\`: **${mainCi.conclusion}** — ${mainCi.url}`);
  }
  for (const { workflow, maxAgeDays, lastRun } of schedules) {
    const age = lastRun && ageD(lastRun.createdAt);
    const msg = !lastRun ? 'no scheduled run found'
      : age > maxAgeDays ? `last scheduled run ${age} d ago (skipped cron?) — ${lastRun.url}`
      : lastRun.status === 'completed' && !['success', 'skipped'].includes(lastRun.conclusion)
        ? `last scheduled run **${lastRun.conclusion}** — ${lastRun.url}`
        : null;
    if (msg) runLines.push(`- [ ] \`${workflow}\`: ${msg}`);
  }
  section('Scheduled runs', runLines);

  section(`Dependabot alerts untriaged for ${STALE_ALERT_DAYS} days`, alerts
    .filter((a) => ageD(a.createdAt) >= STALE_ALERT_DAYS)
    .map((a) => item(a.number, a.title, `(open for ${ageD(a.createdAt)} d)`)));

  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  section('Deadlines', deadlines.flatMap((d) => {
    const due = parseDeadline(d.body);
    const days = due && Math.round((due - today) / DAY); // 0 = due today, not overdue
    const rest = !due ? `— label \`${DEADLINE_LABEL}\` without a \`Due: YYYY-MM-DD\` line`
      : days < 0 ? `— **overdue since ${isoDay(due)}**`
      : days <= DEADLINE_SOON_DAYS ? `— due ${isoDay(due)}`
      : null;
    return rest ? [item(d.number, d.title, rest)] : [];
  }));

  const markdown = count
    ? [
        `Digest of ${isoDay(now)}: **${count} item(s)** wait for a decision or an action.`,
        ...sections,
        '---',
        '_Issue generated by `weekly-digest.yml` and replaced every week (the previous one is closed). ' +
          'Rules and thresholds: `docs/conventions/weekly-digest.md`._',
        ...(hasCi ? [] : [`_No workflow named \`${CI_WORKFLOW}\` in \`.github/workflows/\`: pull requests are listed on conflicts and age only (\`scripts/weekly-digest.config.mjs\`)._`]),
      ].join('\n\n')
    : `Digest of ${isoDay(now)}: nothing waiting.`;
  return { count, markdown };
}

// ── GitHub I/O ────────────────────────────────────────────────────────────────

function client(token, repo) {
  const base = `https://api.github.com/repos/${repo}`;
  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'weekly-digest',
  };
  async function call(method, path, body) {
    const res = await fetch(path.startsWith('http') ? path : `${base}${path}`, {
      method,
      headers: body ? { ...headers, 'content-type': 'application/json' } : headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`${method} ${path.split('?')[0]} → ${res.status}`);
    return { data: res.status === 204 ? null : await res.json(), link: res.headers.get('link') };
  }
  async function all(path, pick = (d) => d) {
    const out = [];
    let url = path;
    for (let i = 0; url && i < 10; i++) {
      const { data, link } = await call('GET', url);
      out.push(...pick(data));
      url = link?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
    }
    return out;
  }
  return { call, all };
}

async function latestRun(gh, workflow, query) {
  const { data } = await gh.call('GET', `/actions/workflows/${workflow}/runs?per_page=1&${query}`);
  const r = data.workflow_runs?.[0];
  return r
    ? { createdAt: r.created_at, status: r.status, conclusion: r.conclusion, url: r.html_url, message: r.head_commit?.message ?? '' }
    : null;
}

/**
 * The single-PR endpoint (the list omits changed_files and mergeability).
 * GitHub computes mergeability lazily: the first read is often `unknown`.
 */
async function prDetail(gh, number) {
  for (let i = 0; ; i++) {
    const { data } = await gh.call('GET', `/pulls/${number}`);
    if ((data.mergeable !== null && data.mergeable_state !== 'unknown') || i === 3) return data;
    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function collectPr(gh, p, ciFile) {
  const [listing, detail, run] = await Promise.all([
    gh.all(`/pulls/${p.number}/files?per_page=100`),
    prDetail(gh, p.number),
    ciFile ? latestRun(gh, ciFile, `event=pull_request&head_sha=${p.head.sha}`) : null,
  ]);
  return {
    number: p.number,
    title: p.title,
    createdAt: p.created_at,
    author: p.user?.login ?? '',
    headRef: p.head.ref,
    // Both sides of a rename, as auto-merge.yml counts them.
    files: listing.flatMap((f) => (f.previous_filename ? [f.filename, f.previous_filename] : [f.filename])),
    filesComplete: listing.length >= (detail.changed_files ?? 0),
    mergeableState: detail.mergeable_state,
    ci: run && { status: run.status, conclusion: run.conclusion },
    updateTypes: [...(run?.message ?? '').matchAll(/update-type: version-update:(semver-[a-z]+)/g)].map((m) => m[1]),
  };
}

/** Latest completed CI run of the default branch itself: not a pull_request run from a fork branch of the same name. */
async function mainCiRun(gh, repo, ciFile) {
  const { data } = await gh.call('GET', `/actions/workflows/${ciFile}/runs?branch=${encodeURIComponent(DEFAULT_BRANCH)}&status=completed&per_page=20`);
  const r = (data.workflow_runs ?? []).find((x) => x.event !== 'pull_request' && x.head_repository?.full_name === repo);
  return r ? { conclusion: r.conclusion, url: r.html_url } : null;
}

/** Map with at most `limit` calls in flight (GitHub's secondary rate limit dislikes bursts). */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const openIssues = (gh, label) =>
  gh.all(`/issues?state=open&labels=${label}&per_page=100`, (d) => d.filter((i) => !i.pull_request));

async function collect(gh, repo, now) {
  const rules = loadRules();
  const ciFile = ciWorkflowFile(CI_WORKFLOW); // null: no workflow carries that name
  const watched = scheduledWorkflows().filter((w) => w !== SELF);

  const [prs, alertIssues, deadlineIssues, lastRuns, mainCi] = await Promise.all([
    gh.all('/pulls?state=open&per_page=100').then((open) => mapLimit(open, 4, (p) => collectPr(gh, p, ciFile))),
    openIssues(gh, 'dependabot-alert'),
    openIssues(gh, DEADLINE_LABEL),
    mapLimit(watched, 4, (w) => latestRun(gh, w, 'event=schedule')),
    ciFile ? mainCiRun(gh, repo, ciFile) : null,
  ]);

  return {
    now,
    prs,
    alerts: alertIssues.map((i) => ({ number: i.number, title: i.title, createdAt: i.created_at })),
    deadlines: deadlineIssues.map((i) => ({ number: i.number, title: i.title, body: i.body })),
    schedules: watched.map((workflow, k) => ({
      workflow, maxAgeDays: MAX_AGE_DAYS[workflow] ?? DEFAULT_MAX_AGE_DAYS, lastRun: lastRuns[k],
    })),
    mainCi,
    ...rules,
    hasCi: ciFile !== null,
  };
}

async function publish(gh, owner, { count, markdown }, now) {
  // Labels are idempotent: 422 = already there.
  for (const [name, color, description] of [
    [DIGEST_LABEL, '0E8A16', 'Weekly digest of what waits on the owner'],
    [DEADLINE_LABEL, 'FBCA04', 'Follow-up with a "Due: YYYY-MM-DD" line, picked up by the weekly digest'],
  ]) {
    await gh.call('POST', '/labels', { name, color, description }).catch((e) => {
      if (!String(e.message).endsWith('422')) throw e;
    });
  }
  const previous = await openIssues(gh, DIGEST_LABEL);
  let created = null;
  if (count > 0) {
    const issue = { title: `Weekly digest of ${isoDay(now)} — ${count} item(s) waiting`, body: markdown, labels: [DIGEST_LABEL] };
    // The assignment is what notifies; an unassignable owner (an org, a
    // renamed login) must not cost the digest itself.
    ({ data: created } = await gh.call('POST', '/issues', { ...issue, assignees: [owner] }).catch(async (e) => {
      if (!String(e.message).endsWith('422')) throw e;
      console.log(`::warning::could not assign ${owner}: the digest is posted unassigned, so GitHub will not notify`);
      return gh.call('POST', '/issues', issue);
    }));
    console.log(`Opened #${created.number}`);
  }
  for (const i of previous) {
    const note = created ? `Superseded by #${created.number}.` : 'Nothing waiting any more.';
    await gh.call('POST', `/issues/${i.number}/comments`, { body: note });
    await gh.call('PATCH', `/issues/${i.number}`, { state: 'closed', state_reason: 'completed' });
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, GITHUB_STEP_SUMMARY: summary } = process.env;
  if (!token || !repo) throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY are required');
  const gh = client(token, repo);
  const now = new Date();
  const digest = buildDigest(await collect(gh, repo, now));
  console.log(digest.markdown);
  if (summary) appendFileSync(summary, `${digest.markdown}\n`);
  if (!dryRun) await publish(gh, repo.split('/')[0], digest, now);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(`::error::${e.message}`);
    process.exit(1);
  });
}
