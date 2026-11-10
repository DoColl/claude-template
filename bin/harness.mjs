#!/usr/bin/env node
// harness — install claude-template modules into a project. No dependency
// beyond Node (>= 20). Exit codes: 0 done, 1 error, 2 done but conflicts were
// left untouched.
import { parseArgs } from "node:util";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { loadKit, listModules, resolveSelection, PHASES } from "../lib/kit.mjs";
import { buildPlan, applyPlan, summarize, readManifest, resolveValues, pendingWork, drift, MANIFEST } from "../lib/install.mjs";

const USAGE = `claude-template — a modular Claude Code harness for a project

  node bin/harness.mjs list [--json]              the modules, by adoption phase
  node bin/harness.mjs init <dir> [options]       install modules into <dir>
  node bin/harness.mjs add <dir> --modules a,b    add modules to an initialised project
  node bin/harness.mjs status <dir>               what is installed, what drifted, what is left to write
  node bin/harness.mjs update <dir> [--dry-run]   refresh the kit-owned files left untouched

Options for init / add:
  --modules a,b    module ids (what they require is added; "core" always is)
  --all            every module
  --set KEY=VALUE  a placeholder value (repeatable); defaults are used otherwise
  --dry-run        show the plan, write nothing
  --force          overwrite kit files that differ in the project (never the
                   project-owned seeds such as CLAUDE.md)

Without --modules or --all, init asks which modules to install when run in a
terminal. Running init again is safe: files already in place are left alone.`;

const out = (s = "") => process.stdout.write(`${s}\n`);
class Usage extends Error {}

function parseSets(list = []) {
  const given = {};
  for (const item of list) {
    const eq = item.indexOf("=");
    if (eq < 1) throw new Usage(`--set expects KEY=VALUE, got "${item}"`);
    given[item.slice(0, eq)] = item.slice(eq + 1);
  }
  return given;
}

function requireDir(dir, { create = false } = {}) {
  if (!dir) throw new Usage("missing <dir>");
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs)) {
    if (!create) throw new Usage(`${abs} does not exist`);
    fs.mkdirSync(abs, { recursive: true });
  } else if (!fs.statSync(abs).isDirectory()) throw new Usage(`${abs} is not a directory`);
  return abs;
}

function printList(kit, installed = []) {
  for (const phase of PHASES) {
    const mods = listModules(kit).filter((m) => m.phase === phase);
    if (!mods.length) continue;
    out(`\n${phase}`);
    for (const m of mods) {
      const flags = [m.required ? "always installed" : null, installed.includes(m.id) ? "installed" : null, m.requires?.length ? `requires ${m.requires.join(", ")}` : null].filter(Boolean);
      out(`  ${m.id.padEnd(16)} ${m.title}${flags.length ? `  (${flags.join("; ")})` : ""}`);
      out(`  ${"".padEnd(16)} ${m.summary}`);
    }
  }
}

async function askModules(kit, rl) {
  printList(kit);
  const recommended = listModules(kit).filter((m) => m.required || m.recommended).map((m) => m.id);
  const answer = (await rl.question(`\nModules to install — ids separated by commas, "all", or Enter for the day-1 set [${recommended.join(", ")}]: `)).trim();
  if (!answer) return recommended;
  if (answer === "all") return [...kit.modules.keys()];
  return answer.split(",").map((s) => s.trim()).filter(Boolean);
}

async function askValues(kit, selected, given, previous, target, rl) {
  const { specs, values } = resolveValues(kit, selected, {}, previous, target);
  for (const [key, spec] of Object.entries(specs)) {
    if (Object.hasOwn(given, key) || (previous && Object.hasOwn(previous, key))) continue;
    for (;;) {
      const answer = (await rl.question(`${spec.prompt} [${values[key]}]: `)).trim();
      if (!answer) break;
      if (new RegExp(`^(?:${spec.pattern})$`).test(answer)) { given[key] = answer; break; }
      out(`  must match ${spec.pattern}`);
    }
  }
  return given;
}

function report(kit, plan, { dryRun, mode }) {
  const s = summarize(plan);
  const verb = dryRun ? "would be " : "";
  out(`${kit.name} ${kit.version} → ${plan.target}${dryRun ? "  (dry run, nothing written)" : ""}`);
  out(`modules: ${plan.selected.join(", ")}${plan.added.length && plan.previous ? `  (new: ${plan.added.join(", ")})` : ""}`);
  const line = (label, items) => { if (items.length) { out(`\n${label} (${items.length})`); for (const i of items) out(`  ${i}`); } };
  line(`${verb}created`, s.created);
  line(`${verb}updated`, s.updated);
  line(`${verb}appended to`, s.appended);
  line(`fragments ${verb}inserted`, s.fragmentsInserted);
  line("kept — project-owned files already present", s.kept);
  if (mode === "update") line("left alone — edited in the project, unchanged in the kit", s.local);
  line("newer version in the kit — run `update` to refresh", s.outdated);
  line("CONFLICTS — left untouched, compare by hand or re-run with --force", s.conflicts.map((c) => `${c.file}  (${c.why})`));
  line("fragments NOT inserted — the slot is gone from the file, paste them by hand", s.fragmentsMissingSlot.map((f) => `${f.source} → ${f.target}`));
  line("recorded earlier but no longer shipped by the installed modules — remove by hand if unused", s.dropped);
  if (!s.created.length && !s.updated.length && !s.appended.length && !s.fragmentsInserted.length) out("\nnothing to write: the project is in step with the kit for these modules");
  return s;
}

function nextSteps(kit, plan) {
  const steps = plan.added.flatMap((id) => (kit.modules.get(id).postInstall ?? []).map((text) => `[${id}] ${text}`));
  if (steps.length) { out("\nNext steps"); for (const step of steps) out(`  - ${step}`); }
  const todos = pendingWork(plan.target, plan.manifest);
  const total = todos.reduce((n, t) => n + t.count, 0);
  if (total) out(`\n${total} TODO(harness) marker(s) left to fill in ${todos.length} file(s) — \`node bin/harness.mjs status <dir>\` lists them.`);
}

async function install(kit, cmd, dir, opt) {
  const target = requireDir(dir, { create: cmd === "init" });
  const previous = readManifest(target);
  if (cmd === "add" && !previous) throw new Usage(`${target} is not initialised (no ${MANIFEST}); use init`);
  const given = parseSets(opt.set);
  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  let moduleIds;
  if (opt.all && opt.modules) throw new Usage("--all and --modules are exclusive");
  if (opt.all) moduleIds = [...kit.modules.keys()];
  else if (opt.modules !== undefined) moduleIds = opt.modules.split(",").map((s) => s.trim()).filter(Boolean);
  else if (previous && cmd === "init") moduleIds = [];
  else if (!interactive) throw new Usage("pass --modules <ids> or --all (no terminal to ask)");
  if (interactive && (moduleIds === undefined || !opt.set)) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      moduleIds ??= await askModules(kit, rl);
      const selected = resolveSelection(kit, [...(previous?.modules ?? []), ...moduleIds]);
      await askValues(kit, selected, given, previous?.values, target, rl);
    } finally { rl.close(); }
  }
  const plan = buildPlan({ kit, target, moduleIds, given, force: Boolean(opt.force) });
  const s = report(kit, plan, { dryRun: opt["dry-run"], mode: "install" });
  if (!opt["dry-run"]) { applyPlan(plan); nextSteps(kit, plan); }
  return s.conflicts.length ? 2 : 0;
}

function update(kit, dir, opt) {
  const target = requireDir(dir);
  if (!readManifest(target)) throw new Usage(`${target} is not initialised (no ${MANIFEST})`);
  const plan = buildPlan({ kit, target, mode: "update", force: Boolean(opt.force) });
  const from = plan.previous.kit?.version;
  if (from && from !== kit.version) out(`kit ${from} → ${kit.version}`);
  const s = report(kit, plan, { dryRun: opt["dry-run"], mode: "update" });
  if (!opt["dry-run"]) applyPlan(plan);
  return s.conflicts.length ? 2 : 0;
}

function status(kit, dir, opt) {
  const target = requireDir(dir);
  const manifest = readManifest(target);
  if (!manifest) throw new Usage(`${target} is not initialised (no ${MANIFEST})`);
  const d = drift(target, manifest);
  const todos = pendingWork(target, manifest);
  const available = listModules(kit).map((m) => m.id).filter((id) => !manifest.modules.includes(id));
  if (opt.json) { out(JSON.stringify({ kit: manifest.kit, current: kit.version, modules: manifest.modules, available, values: manifest.values, ...d, todos }, null, 2)); return 0; }
  out(`${target}`);
  out(`installed from ${manifest.kit?.name ?? "?"} ${manifest.kit?.version ?? "?"}${manifest.kit?.version !== kit.version ? `  (this kit is ${kit.version}: \`update\` refreshes untouched files)` : ""}`);
  out(`modules:   ${manifest.modules.join(", ")}`);
  out(`available: ${available.join(", ") || "(all installed)"}`);
  const line = (label, items) => { if (items.length) { out(`\n${label} (${items.length})`); for (const i of items) out(`  ${i}`); } };
  line("kit files edited in the project", d.modified);
  line("installed files that are gone", d.missing);
  line("TODO(harness) markers left to fill", todos.map((t) => `${t.file}  ×${t.count}`));
  if (!d.modified.length && !d.missing.length && !todos.length) out("\nno drift, nothing left to fill");
  return 0;
}

async function main(argv) {
  const { values: opt, positionals } = parseArgs({
    args: argv, allowPositionals: true,
    options: { modules: { type: "string" }, all: { type: "boolean" }, set: { type: "string", multiple: true }, "dry-run": { type: "boolean" }, force: { type: "boolean" }, json: { type: "boolean" }, help: { type: "boolean", short: "h" } },
  });
  const [cmd, dir, ...extra] = positionals;
  if (opt.help || !cmd || cmd === "help") { out(USAGE); return 0; }
  if (extra.length) throw new Usage(`unexpected argument "${extra[0]}"`);
  const kit = loadKit();
  switch (cmd) {
    case "list":
      if (opt.json) out(JSON.stringify({ name: kit.name, version: kit.version, modules: listModules(kit) }, null, 2));
      else { out(`${kit.name} ${kit.version}`); printList(kit); }
      return 0;
    case "init": case "add": return install(kit, cmd, dir, opt);
    case "update": return update(kit, dir, opt);
    case "status": return status(kit, dir, opt);
    default: throw new Usage(`unknown command "${cmd}"`);
  }
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (e) => { process.stderr.write(`harness: ${e.message}\n${e instanceof Usage ? "\n(node bin/harness.mjs --help)\n" : ""}`); process.exitCode = 1; },
);
