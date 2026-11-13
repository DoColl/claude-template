#!/usr/bin/env node
// ED-2 — the eco-design audit of a change (docs/conventions/eco-design.md).
//
// Runs the audit script of green-claude (scripts/eco-audit.sh, fetched at the
// commit pinned in scripts/eco-design.config.json) on the files a change
// touches, and reports what the change introduces: a rule that fires on a file
// after the change and did not fire on the same file before it. A finding that
// was already there is existing debt: a full run (--all) lists it, a change is
// not charged with it.
//
//   node scripts/eco-design-audit.mjs --green-claude <dir> --base <commit>
//       the working tree against <commit> (in CI: the merge commit against its
//       first parent)
//   node scripts/eco-design-audit.mjs --green-claude <dir> --all
//       every tracked file, as an inventory; never fails on a finding
//
// <dir> is the skills/green-claude directory of a green-claude checkout. The
// audit runs from a copy of its scripts and rules, minus every awk detector
// that can run a command or write a file (system(), getline, a pipe or a
// redirection after print): one of them builds a shell command from the links
// of the audited file, so a crafted link would run on the machine that audits.
// The rules those detectors serve are reported as not audited.
//
// Exit 1 when a new finding reaches `fail_on`, or when the audit could not run:
// an audit that fails in silence reads like a clean one. Otherwise exit 0.
// Under GitHub Actions it also writes annotations and a job summary.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, cpSync, existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const CONFIG = "scripts/eco-design.config.json";
const RANK = { low: 1, medium: 2, high: 3 };
// In an awk detector: a command (system, getline from a command, print into a
// pipe) or a file read or written by name (getline <, print >).
const ACTS_ON_THE_MACHINE = /\bsystem\s*\(|\bgetline\b|\bprintf?\b[^\n]*[|>]/;
const MAX_ANNOTATIONS = 10;
const MAX_ROWS = 300;
const CREDIT = "Rules and audit: [green-claude](https://github.com/Institut-du-Numerique-Responsable/green-claude), Institut du Numérique Responsable and contributors, rules under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).";
const IN_ACTIONS = process.env.GITHUB_ACTIONS === "true";

class Stop extends Error {}

// ─── helpers ────────────────────────────────────────────────────────────
function git(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.error) throw new Stop(`git could not start: ${r.error.message}`);
  if (r.status !== 0) throw new Stop(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout;
}
const nul = (out) => out.split("\0").filter((s) => s !== "");
const extOf = (path) => { const b = basename(path); const i = b.lastIndexOf("."); return (i === -1 ? b : b.slice(i + 1)).toLowerCase(); };
const isRegularFile = (path) => { try { return lstatSync(path).isFile(); } catch { return false; } };
const rank = (impact) => RANK[String(impact).toLowerCase()] ?? RANK.high; // an impact this script does not know counts as high
const lineOf = (f) => f.lines.map((l) => /^(\d+):/.exec(l)?.[1]).find(Boolean) ?? "";
const where = (f) => (lineOf(f) ? `${f.file}:${lineOf(f)}` : f.file);

// Workflow commands: data escaped so that nothing a file holds can end the
// command or start another one.
const data = (s) => String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const prop = (s) => data(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
// Markdown: text from a file is never read as markup.
const md = (s) => String(s).replace(/[\r\n]+/g, " ").replace(/[\\`*_{}[\]()<>#!|~]/g, "\\$&");
const cell = (s) => {
  const t = String(s).replace(/[\r\n]+/g, " ");
  const fence = "`".repeat(Math.max(0, ...[...t.matchAll(/`+/g)].map((m) => m[0].length)) + 1);
  return `${fence} ${t} ${fence}`.replace(/\|/g, "\\|");
};

// ─── arguments and configuration ────────────────────────────────────────
function readArgs(argv) {
  const o = { all: false, base: "", skill: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") o.all = true;
    else if (a === "--base" || a === "--green-claude") {
      const v = argv[++i];
      if (!v) throw new Stop(`${a} needs a value`);
      if (a === "--base") o.base = v; else o.skill = v;
    } else throw new Stop(`unknown argument: ${a}`);
  }
  if (!o.skill) throw new Stop("--green-claude <the skills/green-claude directory of a checkout> is required");
  if (o.all === Boolean(o.base)) throw new Stop("give either --base <commit> or --all");
  return o;
}

function readConfig(path) {
  let c;
  try { c = JSON.parse(readFileSync(path, "utf8")); } catch (e) { throw new Stop(`${CONFIG} cannot be read: ${e.message}`); }
  const failOn = String(c.fail_on ?? "none").toLowerCase();
  if (failOn !== "none" && !RANK[failOn]) throw new Stop(`${CONFIG}: fail_on is none, low, medium or high, not "${c.fail_on}"`);
  return { failOn, commit: String(c.commit ?? ""), repository: String(c.repository ?? "") };
}

// ─── the audit ──────────────────────────────────────────────────────────
function ruleFiles(skill) {
  const langs = join(skill, "rules", "langages");
  const extra = existsSync(langs) ? readdirSync(langs).filter((f) => f.endsWith(".json")).sort().map((f) => join(langs, f)) : [];
  return [join(skill, "rules", "ecoconception.json"), ...extra].map((f) => JSON.parse(readFileSync(f, "utf8")));
}

// A copy of the skill's scripts and rules without the detectors that act on
// the machine. The checkout itself is left as it is.
function prepare(dir, work) {
  const src = resolve(dir);
  for (const need of ["scripts/eco-audit.sh", "scripts/audit-common.sh", "rules/ecoconception.json"])
    if (!existsSync(join(src, need))) throw new Stop(`${src} is not the skills/green-claude directory of a green-claude checkout: ${need} is missing`);
  const skill = join(work, "green-claude");
  cpSync(join(src, "scripts"), join(skill, "scripts"), { recursive: true });
  cpSync(join(src, "rules"), join(skill, "rules"), { recursive: true });
  const dropped = [];
  for (const name of readdirSync(join(skill, "scripts")).sort()) {
    if (!/^detect-.+\.awk$/.test(name)) continue;
    const file = join(skill, "scripts", name);
    const code = readFileSync(file, "utf8").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    if (ACTS_ON_THE_MACHINE.test(code)) { unlinkSync(file); dropped.push(name); }
  }
  const catalogues = ruleFiles(skill);
  const rules = catalogues.flatMap((j) => (j.categories ?? []).flatMap((c) => c.rules ?? []));
  const notAudited = rules.filter((r) => r.detector && dropped.includes(`detect-${String(r.detector).replaceAll("_", "-")}.awk`)).map((r) => r.id);
  const exts = new Set();
  for (const j of catalogues) {
    for (const e of j.metadata?.extensions ?? []) exts.add(String(e).toLowerCase());
    for (const c of j.categories ?? []) for (const r of c.rules ?? []) for (const e of r.extensions ?? []) exts.add(String(e).toLowerCase());
  }
  // As the upstream hooks do: prose and catalogues are audited on request only.
  exts.delete("md"); exts.delete("json");
  return { skill, dropped, notAudited, exts };
}

function parse(text) {
  const findings = [];
  let hidden = 0, cur = null;
  for (const line of text.split("\n")) {
    const head = /^\[([^\]]+)\] (\S+) — (.*)$/.exec(line);
    if (head) { cur = { impact: head[1], id: head[2], title: head[3], file: "", lines: [], recommendation: "", note: "" }; findings.push(cur); continue; }
    const h = /^(\d+) finding\(s\) hidden by decisions/.exec(line);
    if (h) { hidden += Number(h[1]); cur = null; continue; }
    if (!cur) continue;
    if (line === "") { cur = null; continue; }
    const field = /^ {2}([A-Za-z][A-Za-z ]*?) *: (.*)$/.exec(line);
    if (!field) continue; // the continuation of an example
    const [, key, value] = field;
    if (key === "File") cur.file = value.replace(/^\.\//, "");
    else if (key === "Line") cur.lines.push(value);
    else if (key === "Recommendation") cur.recommendation = value;
    else if (key === "Note") cur.note = value;
  }
  const total = /^(\d+) ecodesign issue\(s\) found\.$/m.exec(text)?.[1] ?? (/^No ecodesign issue found/m.test(text) ? "0" : null);
  if (total === null) throw new Stop("eco-audit.sh printed no total: its report is not in the format this script reads");
  if (Number(total) !== findings.length) throw new Stop(`eco-audit.sh announced ${total} finding(s) and ${findings.length} could be read: its report format changed`);
  return { findings, hidden };
}

function runAudit(skill, cwd, paths) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GREEN_CLAUDE_")));
  const out = { findings: [], hidden: 0 };
  for (let i = 0; i < paths.length; i += 200) {
    const chunk = paths.slice(i, i + 200);
    // `./` keeps a file name from being read as an option or an awk assignment.
    const r = spawnSync("bash", [join(skill, "scripts", "eco-audit.sh"), ...chunk.map((p) => `./${p}`)], { cwd, env, encoding: "utf8", maxBuffer: 1 << 28 });
    if (r.error) throw new Stop(`eco-audit.sh could not start: ${r.error.message}`);
    if (r.status !== 0) throw new Stop(`eco-audit.sh exited with ${r.status}: ${(r.stderr || r.stdout).trim().split("\n").slice(-3).join(" / ")}`);
    const part = parse(r.stdout);
    out.findings.push(...part.findings);
    out.hidden += part.hidden;
  }
  return out;
}

// The files a change adds, modifies, copies or renames, with the path each one
// had before when it had one.
function changes(base) {
  const f = nul(git(["diff", "--name-status", "-z", "-M", "--diff-filter=ACMR", base, "--"]));
  const list = [];
  for (let i = 0; i < f.length;) {
    const status = f[i++];
    if (status[0] === "R" || status[0] === "C") { const from = f[i++], to = f[i++]; list.push({ path: to, before: status[0] === "R" ? from : "" }); }
    else { const p = f[i++]; list.push({ path: p, before: status[0] === "M" ? p : "" }); }
  }
  return list;
}

function atBase(base, work, fn) {
  const dir = join(work, "base");
  // No hook of the repository runs for this checkout.
  git(["-c", "core.hooksPath=/dev/null", "worktree", "add", "--detach", "--quiet", dir, base]);
  try { return fn(dir); }
  finally { spawnSync("git", ["worktree", "remove", "--force", dir]); spawnSync("git", ["worktree", "prune"]); }
}

// ─── report ─────────────────────────────────────────────────────────────
function summary(lines) {
  if (IN_ACTIONS && process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
}

function table(findings) {
  const rows = findings.slice(0, MAX_ROWS).map((f) => `| ${md(f.impact)} | ${md(f.id)} | ${cell(f.file)} | ${lineOf(f) || "—"} | ${md(f.title)} |`);
  const more = findings.length > MAX_ROWS ? [``, `${findings.length - MAX_ROWS} more, not shown.`] : [];
  return ["| Impact | Rule | File | Line | What |", "|---|---|---|---|---|", ...rows, ...more];
}

function advice(findings) {
  const seen = new Map();
  for (const f of findings) if (!seen.has(f.id)) seen.set(f.id, f);
  return ["<details><summary>What each rule recommends</summary>", "",
    ...[...seen.values()].map((f) => `- **${md(f.id)}** ${md(f.title)}: ${md(f.recommendation)}${f.note ? ` _${md(f.note)}_` : ""}`),
    "", "</details>"];
}

function footer(ctx, hidden) {
  const out = [];
  if (ctx.notAudited.length) out.push(`Not audited: ${ctx.notAudited.map(md).join(", ")}. The detector behind ${ctx.notAudited.length === 1 ? "it" : "them"} (${ctx.dropped.map(cell).join(", ")}) can run a command on the machine that audits, so this audit leaves it out.`);
  if (hidden) out.push(`${hidden} finding(s) hidden by \`.green-claude/decisions.md\`.`);
  out.push("", CREDIT);
  return out;
}

// Plain text in the log. Under Actions, workflow commands are off while it
// prints: a line of an audited file cannot become one.
function log(lines) {
  const token = IN_ACTIONS ? randomUUID() : "";
  if (token) console.log(`::stop-commands::${token}`);
  for (const l of lines) console.log(l);
  if (token) console.log(`::${token}::`);
}

// ─── modes ──────────────────────────────────────────────────────────────
function review(base, config, ctx, work) {
  const baseSha = git(["rev-parse", "--verify", "--quiet", `${base}^{commit}`]).trim();
  const touched = nul(git(["diff", "--name-only", "-z", baseSha, "--"]));
  const changed = changes(baseSha).filter((c) => ctx.exts.has(extOf(c.path)) && isRegularFile(c.path));
  const head = runAudit(ctx.skill, process.cwd(), changed.map((c) => c.path));
  const befores = [...new Set(changed.map((c) => c.before).filter(Boolean))];
  const before = befores.length
    ? atBase(baseSha, work, (dir) => runAudit(ctx.skill, dir, befores.filter((p) => isRegularFile(join(dir, p)))))
    : { findings: [], hidden: 0 };
  const had = new Map();
  for (const f of before.findings) { if (!had.has(f.file)) had.set(f.file, new Set()); had.get(f.file).add(f.id); }
  const beforeOf = new Map(changed.map((c) => [c.path, c.before]));
  const fresh = head.findings.filter((f) => !had.get(beforeOf.get(f.file) || "")?.has(f.id));
  const blocking = config.failOn === "none" ? [] : fresh.filter((f) => rank(f.impact) >= RANK[config.failOn]);
  const decisions = touched.filter((p) => p.startsWith(".green-claude/"));

  if (IN_ACTIONS) {
    for (const f of fresh.slice(0, MAX_ANNOTATIONS)) {
      const level = blocking.includes(f) ? "error" : "warning";
      const line = lineOf(f) ? `,line=${lineOf(f)}` : "";
      console.log(`::${level} file=${prop(f.file)}${line},title=${prop(`${f.id} (${f.impact})`)}::${data(`${f.title}. ${f.recommendation}`)}`);
    }
  }
  const pin = `green-claude \`${config.commit.slice(0, 7) || "?"}\`, fail_on \`${config.failOn}\``;
  const lead = !changed.length ? "Nothing to audit: no file this change touches is of a kind the rules cover."
    : !fresh.length ? `No new finding in the ${changed.length} file(s) this change touches.`
    : `**${fresh.length} new finding(s)** in the ${changed.length} file(s) this change touches${blocking.length ? `, ${blocking.length} at or above \`${config.failOn}\`: the check fails` : ""}. Each one is a candidate: read the code around it, then fix it or record a decision in \`.green-claude/decisions.md\` with its reason.`;
  summary(["## Eco-design audit", "", pin, "", lead,
    ...(fresh.length ? ["", ...table(fresh), "", ...advice(fresh)] : []),
    ...(decisions.length ? ["", `This change edits ${decisions.map(cell).join(", ")}: a decision there silences a finding, read it as a derogation.`] : []),
    "", ...footer(ctx, head.hidden)]);
  log([`eco-design: ${pin.replace(/`/g, "")}; ${changed.length} file(s) audited against ${baseSha.slice(0, 7)}, ${fresh.length} new finding(s)`,
    ...fresh.flatMap((f) => [`  [${f.impact}] ${f.id} ${where(f)} — ${f.title}`, `      ${f.recommendation}`]),
    ...(ctx.notAudited.length ? [`eco-design: not audited: ${ctx.notAudited.join(", ")} (${ctx.dropped.join(", ")} can run a command)`] : []),
    ...(head.hidden ? [`eco-design: ${head.hidden} finding(s) hidden by .green-claude/decisions.md`] : []),
    ...(decisions.length ? [`eco-design: this change edits ${decisions.join(", ")}`] : [])]);
  if (blocking.length) {
    const message = `${blocking.length} new finding(s) at or above fail_on ${config.failOn}: fix them, or record a decision in .green-claude/decisions.md`;
    console.error(`eco-design: ${message}`);
    return 1;
  }
  return 0;
}

function inventory(config, ctx) {
  const files = nul(git(["ls-files", "-z"])).filter((p) => ctx.exts.has(extOf(p)) && isRegularFile(p));
  const all = runAudit(ctx.skill, process.cwd(), files);
  const pin = `green-claude \`${config.commit.slice(0, 7) || "?"}\``;
  summary(["## Eco-design inventory", "", pin, "",
    `${all.findings.length} finding(s) in the ${files.length} tracked file(s) of a kind the rules cover. An inventory: it fails on nothing.`,
    ...(all.findings.length ? ["", ...table(all.findings), "", ...advice(all.findings)] : []),
    "", ...footer(ctx, all.hidden)]);
  log([`eco-design: ${pin.replace(/`/g, "")}; inventory of ${files.length} file(s), ${all.findings.length} finding(s)`,
    ...all.findings.map((f) => `  [${f.impact}] ${f.id} ${where(f)} — ${f.title}`)]);
  return 0;
}

// ─── main ───────────────────────────────────────────────────────────────
function main() {
  let work = "";
  try {
    const opts = readArgs(process.argv.slice(2));
    const skillDir = resolve(opts.skill);
    process.chdir(git(["rev-parse", "--show-toplevel"]).trim());
    const config = readConfig(CONFIG);
    work = mkdtempSync(join(tmpdir(), "eco-design-"));
    const ctx = prepare(skillDir, work);
    return opts.all ? inventory(config, ctx) : review(opts.base, config, ctx, work);
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    // One line: a message can quote git or the audit, and so a file name.
    const message = `the audit did not run: ${e.message.replace(/\s*[\r\n]+\s*/g, " / ")}`;
    console.error(`eco-design: ${message}`);
    if (IN_ACTIONS) console.log(`::error title=Eco-design audit::${data(message)}`);
    return 1;
  } finally {
    if (work) rmSync(work, { recursive: true, force: true });
  }
}

process.exitCode = main();
