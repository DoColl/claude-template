// Planning and applying an installation. `buildPlan` reads the kit and the
// target and decides what would happen to every file; `applyPlan` writes.
// Nothing is written before the whole plan is known.
//
// File classes (docs/module-authoring.md):
//   kit-owned — machinery (hooks, guards, workflows). Recorded with a hash in
//               the manifest so `update` can refresh the ones left untouched.
//   seed      — skeletons the project fills in (CLAUDE.md, docs indexes,
//               configs). Created once, never overwritten, the only files
//               fragments may be inserted into.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { resolveSelection } from "./kit.mjs";
import { render, insertAtSlot, appendBlock } from "./render.mjs";

export const MANIFEST = ".claude/harness.json";
export const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

const lstat = (p) => { try { return fs.lstatSync(p); } catch (e) { if (e.code === "ENOENT" || e.code === "ENOTDIR") return null; throw e; } };

// Relative POSIX paths of the regular files under dir, sorted.
export function walk(dir) {
  const out = [];
  const visit = (abs, rel) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (entry.name === ".DS_Store") continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const childAbs = path.join(abs, entry.name);
      if (entry.isDirectory()) visit(childAbs, childRel);
      else if (entry.isFile()) out.push(childRel);
      else throw new Error(`${childAbs}: a module holds regular files and directories only`);
    }
  };
  if (lstat(dir)?.isDirectory()) visit(dir, "");
  return out;
}

const isSeed = (mod, rel) => (mod.seed ?? []).some((g) => g === rel || (g.endsWith("/**") && rel.startsWith(g.slice(0, -2))));

// Every path the installer writes must stay inside the project. `lstat` on the
// destination only sees its last component: a directory symlink higher up (a
// cloned repository can carry one, pointing at a user-level config directory)
// would send the write somewhere else. So the deepest existing ancestor of each
// destination is resolved and must be a directory inside the resolved project.
function assertInside(target, rel) {
  const root = fs.realpathSync(target);
  let dir = path.dirname(path.join(target, rel));
  while (!lstat(dir)) dir = path.dirname(dir);
  let real;
  try { real = fs.realpathSync(dir); } catch { throw new Error(`${rel}: ${path.relative(target, dir) || "."} is a broken link — refusing to write through it`); }
  if (!fs.statSync(real).isDirectory()) throw new Error(`${rel}: ${path.relative(target, dir)} exists and is not a directory`);
  if (real !== root && !real.startsWith(root + path.sep)) throw new Error(`${rel}: ${path.relative(target, dir)} resolves outside the project (${real}) — a symlink on the way; refusing to write through it`);
}

export function readManifest(target) {
  const file = path.join(target, MANIFEST);
  const st = lstat(file);
  if (!st) return null;
  if (!st.isFile()) throw new Error(`${MANIFEST} exists and is not a regular file`);
  assertInside(target, MANIFEST);
  let m;
  try { m = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { throw new Error(`${MANIFEST} is not valid JSON (${e.message})`); }
  const ok = m && typeof m === "object" && Array.isArray(m.modules) && m.modules.every((x) => typeof x === "string")
    && m.values && typeof m.values === "object" && m.files && typeof m.files === "object" && Array.isArray(m.fragments);
  if (!ok) throw new Error(`${MANIFEST} does not look like a harness manifest`);
  return m;
}

// Placeholder values for the selected modules: given > previously stored >
// default. Every value is checked against the pattern its module declares —
// values end up in YAML, shell and Markdown.
export function resolveValues(kit, selected, given, previous, target) {
  const specs = {};
  for (const id of selected) {
    for (const [key, spec] of Object.entries(kit.modules.get(id).placeholders ?? {})) {
      if (specs[key] && JSON.stringify(specs[key].spec) !== JSON.stringify(spec)) throw new Error(`placeholder ${key} is declared differently by ${specs[key].module} and ${id}`);
      specs[key] ??= { spec, module: id };
    }
  }
  for (const key of Object.keys(given)) if (!specs[key]) throw new Error(`unknown placeholder ${key} (the selected modules use: ${Object.keys(specs).join(", ") || "none"})`);
  const values = {};
  for (const [key, { spec }] of Object.entries(specs)) {
    const fits = new RegExp(`^(?:${spec.pattern})$`);
    const dirname = path.basename(path.resolve(target));
    const fallback = spec.default !== "@dirname" ? spec.default : fits.test(dirname) ? dirname : "project"; // a directory name the pattern refuses is not worth an error
    const value = given[key] ?? previous?.[key] ?? fallback;
    if (typeof value !== "string" || !fits.test(value)) throw new Error(`${key}="${value}" does not match ${spec.pattern} (set it with --set ${key}=…)`);
    values[key] = value;
  }
  return { values, specs: Object.fromEntries(Object.entries(specs).map(([k, v]) => [k, v.spec])) };
}

// mode: "install" (init / add) or "update". force: overwrite files that differ.
export function buildPlan({ kit, target, moduleIds = [], given = {}, mode = "install", force = false }) {
  const previous = readManifest(target);
  const selected = resolveSelection(kit, [...(previous?.modules ?? []), ...moduleIds]);
  const { values } = resolveValues(kit, selected, given, previous?.values, target);

  // 1. every file the selected modules ship, rendered
  const files = new Map();
  for (const id of selected) {
    const mod = kit.modules.get(id);
    for (const rel of walk(path.join(mod.dir, "files"))) {
      if (files.has(rel)) throw new Error(`modules ${files.get(rel).module} and ${id} both ship ${rel}`);
      if (rel === MANIFEST) throw new Error(`${id} ships ${MANIFEST}, which the installer owns`);
      const src = path.join(mod.dir, "files", rel);
      files.set(rel, { module: id, seed: isSeed(mod, rel), mode: fs.statSync(src).mode & 0o777, content: render(fs.readFileSync(src, "utf8"), values, `${id}/files/${rel}`) });
    }
  }

  // 2. what happens to each, given the target
  assertInside(target, MANIFEST);
  for (const [rel, f] of files) {
    assertInside(target, rel);
    const st = lstat(path.join(target, rel));
    if (!st) { f.action = "create"; continue; }
    if (!st.isFile()) { f.action = "conflict"; f.why = "exists and is not a regular file"; continue; }
    f.current = fs.readFileSync(path.join(target, rel), "utf8");
    if (f.current === f.content) { f.action = "same"; continue; }
    if (f.seed) { f.action = "keep"; continue; }
    const recorded = previous?.files?.[rel]?.sha256;
    if (recorded === sha256(f.current)) f.action = mode === "update" || force ? "update" : "outdated"; // untouched since installed, newer in the kit
    else if (force) f.action = "overwrite";
    else if (recorded === sha256(f.content)) f.action = "local"; // edited in the project, unchanged in the kit: nothing to do
    else { f.action = "conflict"; f.why = recorded ? "modified here and changed in the kit" : "already exists with other content"; }
  }

  // 3. fragments, inserted into seed files at their slots, once
  const done = new Set(previous?.fragments ?? []);
  const fragments = [];
  for (const id of selected) {
    const dir = path.join(kit.modules.get(id).dir, "fragments");
    for (const rel of walk(dir)) {
      if (!rel.endsWith(".frag") || !rel.includes("/")) throw new Error(`${id}/fragments/${rel}: expected <target file path>/<slot>.frag`);
      const targetRel = path.posix.dirname(rel);
      const key = `${id}:${targetRel}#${path.posix.basename(rel, ".frag")}`;
      if (done.has(key)) { fragments.push({ key, status: "done" }); continue; }
      const f = files.get(targetRel);
      if (!f) { fragments.push({ key, status: "no-target" }); continue; } // its file belongs to a module that is not installed
      if (!f.seed) throw new Error(`${key}: fragments may only target seed files`);
      const text = render(fs.readFileSync(path.join(dir, rel), "utf8"), values, `${id}/fragments/${rel}`);
      const base = f.patched ?? (f.action === "create" ? f.content : f.current);
      const patched = base === undefined ? null : insertAtSlot(base, path.posix.basename(rel, ".frag"), text);
      if (patched === null) { fragments.push({ key, status: "missing-slot", target: targetRel, source: path.posix.join("modules", id, "fragments", rel) }); continue; }
      f.patched = patched;
      fragments.push({ key, status: "insert", target: targetRel });
    }
  }

  // 4. appended blocks (.gitignore)
  const appended = new Map();
  for (const id of selected) {
    const mod = kit.modules.get(id);
    for (const a of mod.append ?? []) {
      if (files.has(a.file)) throw new Error(`${id}: "append" targets ${a.file}, which a module ships as a file`);
      assertInside(target, a.file);
      const st = lstat(path.join(target, a.file));
      if (st && !st.isFile()) throw new Error(`${a.file} exists and is not a regular file`);
      const entry = appended.get(a.file) ?? { text: st ? fs.readFileSync(path.join(target, a.file), "utf8") : "", changed: false };
      const block = render(fs.readFileSync(path.join(mod.dir, a.from), "utf8"), values, `${id}/${a.from}`);
      const res = appendBlock(entry.text, a.marker, block);
      appended.set(a.file, { text: res.text, changed: entry.changed || res.changed });
    }
  }

  // 5. the manifest as it will be once the plan is applied
  const manifest = { kit: { name: kit.name, version: kit.version }, modules: selected, values, files: {}, fragments: [] };
  for (const [rel, f] of files) {
    if (f.seed) { if (f.action !== "conflict") manifest.files[rel] = { module: f.module, seed: true }; continue; }
    if (["create", "same", "update", "overwrite"].includes(f.action)) manifest.files[rel] = { module: f.module, sha256: sha256(f.content) };
    else if (previous?.files?.[rel]) manifest.files[rel] = previous.files[rel]; // outdated / conflict: what was installed is still what is recorded
  }
  for (const fr of fragments) if (fr.status === "done" || fr.status === "insert") manifest.fragments.push(fr.key);
  manifest.fragments.sort();

  // files recorded earlier that no selected module ships any more
  const dropped = Object.keys(previous?.files ?? {}).filter((rel) => !files.has(rel)).sort();

  return { target, previous, selected, added: selected.filter((id) => !(previous?.modules ?? []).includes(id)), values, files, fragments, appended, manifest, dropped };
}

const WRITES = new Set(["create", "update", "overwrite"]);

export function applyPlan(plan) {
  const write = (rel, text, mode) => {
    const dest = path.join(plan.target, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text);
    if (mode !== undefined) fs.chmodSync(dest, mode);
  };
  for (const [rel, f] of plan.files) {
    if (WRITES.has(f.action)) write(rel, f.patched ?? f.content, f.mode);
    else if (f.patched !== undefined && (f.action === "keep" || f.action === "same")) write(rel, f.patched); // a seed already there: only the fragment goes in
  }
  for (const [rel, a] of plan.appended) if (a.changed) write(rel, a.text);
  write(MANIFEST, `${JSON.stringify(plan.manifest, null, 2)}\n`);
}

// Counts and lists for the report.
export function summarize(plan) {
  const by = (action) => [...plan.files].filter(([, f]) => f.action === action).map(([rel]) => rel);
  return {
    created: by("create"), unchanged: by("same"), updated: [...by("update"), ...by("overwrite")], kept: by("keep"), outdated: by("outdated"), local: by("local"),
    conflicts: [...plan.files].filter(([, f]) => f.action === "conflict").map(([rel, f]) => ({ file: rel, why: f.why })),
    fragmentsInserted: plan.fragments.filter((f) => f.status === "insert").map((f) => f.key),
    fragmentsMissingSlot: plan.fragments.filter((f) => f.status === "missing-slot"),
    appended: [...plan.appended].filter(([, a]) => a.changed).map(([rel]) => rel),
    dropped: plan.dropped,
  };
}

// What the project still has to write: TODO(harness) markers and tokens left unrendered.
export function pendingWork(target, manifest) {
  const todos = [];
  for (const rel of Object.keys(manifest?.files ?? {}).sort()) {
    const file = path.join(target, rel);
    if (!lstat(file)?.isFile()) continue;
    const n = (fs.readFileSync(file, "utf8").match(/TODO\(harness\)/g) ?? []).length;
    if (n) todos.push({ file: rel, count: n });
  }
  return todos;
}

// Installed files compared with what the manifest recorded.
export function drift(target, manifest) {
  const out = { modified: [], missing: [] };
  for (const [rel, rec] of Object.entries(manifest.files)) {
    const st = lstat(path.join(target, rel));
    if (!st?.isFile()) { out.missing.push(rel); continue; }
    if (!rec.seed && sha256(fs.readFileSync(path.join(target, rel), "utf8")) !== rec.sha256) out.modified.push(rel);
  }
  return out;
}
