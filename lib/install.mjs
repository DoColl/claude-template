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
import { render, insertAtSlot, appendBlock, removeFromSlot, removeBlock } from "./render.mjs";
import { findBase, merge3 } from "./merge.mjs";

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
    let fallback = spec.default !== "@dirname" ? spec.default : fits.test(dirname) ? dirname : "project"; // a directory name the pattern refuses is not worth an error
    if (spec.default === "@kit-repository") fallback = kit.repository;
    const value = given[key] ?? previous?.[key] ?? fallback;
    if (value === undefined) throw new Error(`${key} has no default: kit.json names no "repository" (set it with --set ${key}=<owner>/<name>)`);
    if (typeof value !== "string" || !fits.test(value)) throw new Error(`${key}="${value}" does not match ${spec.pattern} (set it with --set ${key}=…)`);
    values[key] = value;
  }
  return { values, specs: Object.fromEntries(Object.entries(specs).map(([k, v]) => [k, v.spec])) };
}

// A selection for a partial update: `modules` (ids) and `only` (a file, or a
// directory and everything under it), both optional; a file must satisfy both.
export function selector({ modules = [], only = [] } = {}) {
  if (!modules.length && !only.length) return null;
  const paths = only.map((p) => p.replace(/^(\.\/)+/, "").replace(/\/+$/, ""));
  return (module, rel) => (!modules.length || modules.includes(module)) && (!paths.length || paths.some((p) => rel === p || rel.startsWith(`${p}/`)));
}

// How far a project's file is from the kit's: lines found on one side only.
// A measure to sort an adoption by, not a diff.
function distance(here, kit) {
  const a = here.split("\n"), b = kit.split("\n"), inA = new Set(a), inB = new Set(b);
  return { onlyHere: a.filter((l) => !inB.has(l)).length, onlyKit: b.filter((l) => !inA.has(l)).length };
}

// mode: "install" (init / add), "adopt" or "update". force: overwrite files
// that differ. "adopt" is an install into a project that already holds its own
// version of some kit files: such a file is left as it is and recorded with the
// hash of the kit's version, which is what a kit file edited in the project
// looks like — `status` and HD-1 list it, and `update` reports a conflict the
// day the kit changes it.
// select: null for everything, or (module, file) => boolean; what it leaves out
// is "deferred" — not written, and recorded as it was.
// merge (update only): a kit file edited here and changed in the kit is merged
// when the version that was installed is found in the kit's history and the
// two sets of changes do not overlap; otherwise it stays a conflict.
// declineFragments (adopt only): a fragment whose slot the seed does not have
// is recorded as declined — the project's file covers it its own way — and is
// not proposed again.
export function buildPlan({ kit, target, moduleIds = [], given = {}, mode = "install", force = false, select = null, merge = false, declineFragments = false }) {
  const previous = readManifest(target);
  const chosen = (module, rel) => !select || select(module, rel);
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
      files.set(rel, { module: id, seed: isSeed(mod, rel), source: path.posix.join("modules", id, "files", rel), mode: fs.statSync(src).mode & 0o777, content: render(fs.readFileSync(src, "utf8"), values, `${id}/files/${rel}`) });
    }
  }

  // 2. what happens to each, given the target
  assertInside(target, MANIFEST);
  for (const [rel, f] of files) {
    assertInside(target, rel);
    const st = lstat(path.join(target, rel));
    if (!st) { f.action = chosen(f.module, rel) ? "create" : "deferred"; continue; }
    if (!st.isFile()) { f.action = "conflict"; f.why = "exists and is not a regular file"; continue; }
    f.current = fs.readFileSync(path.join(target, rel), "utf8");
    if (f.current === f.content) { f.action = "same"; continue; }
    if (f.seed) { f.action = "keep"; continue; }
    const recorded = previous?.files?.[rel]?.sha256;
    if (recorded === sha256(f.current)) f.action = mode === "update" || force ? "update" : "outdated"; // untouched since installed, newer in the kit
    else if (force) f.action = "overwrite";
    else if (recorded === sha256(f.content)) f.action = "local"; // edited in the project, unchanged in the kit: nothing to do
    else if (mode === "adopt" && !recorded) { f.action = "adopted"; f.delta = distance(f.current, f.content); }
    else { f.action = "conflict"; f.why = recorded ? "modified here and changed in the kit" : "already exists with other content"; }
    if (f.action === "conflict" && recorded && merge && mode === "update" && chosen(f.module, rel)) {
      const base = findBase(kit.root, f.source, (text) => render(text, previous.values, f.source), (text) => sha256(text) === recorded);
      const res = base === null ? null : merge3(f.current, base, f.content);
      if (res?.text !== undefined) { f.action = "merge"; f.merged = res.text; }
      else f.why += base === null ? "; the version installed was not found in the kit's history" : res === null ? "; git could not merge" : `; the two changes overlap in ${res.conflicts} place(s)`;
    }
    if (!chosen(f.module, rel) && ["update", "overwrite", "conflict", "merge"].includes(f.action)) f.action = "deferred";
  }

  // 3. fragments, inserted into seed files at their slots, once
  const done = new Set(previous?.fragments ?? []);
  const declined = new Set((previous?.declined ?? []).filter((k) => typeof k === "string"));
  const fragments = [];
  for (const id of selected) {
    const dir = path.join(kit.modules.get(id).dir, "fragments");
    for (const rel of walk(dir)) {
      if (!rel.endsWith(".frag") || !rel.includes("/")) throw new Error(`${id}/fragments/${rel}: expected <target file path>/<slot>.frag`);
      const targetRel = path.posix.dirname(rel);
      const key = `${id}:${targetRel}#${path.posix.basename(rel, ".frag")}`;
      if (done.has(key)) { fragments.push({ key, status: "done" }); continue; }
      if (declined.has(key)) { fragments.push({ key, status: "declined" }); continue; }
      const f = files.get(targetRel);
      if (!f) { fragments.push({ key, status: "no-target" }); continue; } // its file belongs to a module that is not installed
      if (!f.seed) throw new Error(`${key}: fragments may only target seed files`);
      if (f.action === "deferred" || !chosen(id, targetRel)) { fragments.push({ key, status: "deferred", target: targetRel }); continue; }
      const text = render(fs.readFileSync(path.join(dir, rel), "utf8"), values, `${id}/fragments/${rel}`);
      const base = f.patched ?? (f.action === "create" ? f.content : f.current);
      const patched = base === undefined ? null : insertAtSlot(base, path.posix.basename(rel, ".frag"), text);
      if (patched === null) { fragments.push({ key, status: mode === "adopt" && declineFragments ? "declining" : "missing-slot", target: targetRel, source: path.posix.join("modules", id, "fragments", rel) }); continue; }
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
      if (!chosen(id, a.file)) continue;
      assertInside(target, a.file);
      const st = lstat(path.join(target, a.file));
      if (st && !st.isFile()) throw new Error(`${a.file} exists and is not a regular file`);
      const entry = appended.get(a.file) ?? { text: st ? fs.readFileSync(path.join(target, a.file), "utf8") : "", changed: false };
      const block = render(fs.readFileSync(path.join(mod.dir, a.from), "utf8"), values, `${id}/${a.from}`);
      const res = appendBlock(entry.text, a.marker, block);
      appended.set(a.file, { text: res.text, changed: entry.changed || res.changed });
    }
  }

  // 5. files recorded earlier that no installed module ships any more. An
  // update removes the ones still identical to their recorded hash; an edited
  // one or a seed is the project's to remove. The path comes from the manifest,
  // a file of the project: it is checked like any other the installer touches.
  const dropped = [], removed = [], deferredDrops = [];
  for (const rel of Object.keys(previous?.files ?? {}).filter((r) => !files.has(r)).sort()) {
    const rec = previous.files[rel];
    if (rec?.seed || typeof rec?.sha256 !== "string") { dropped.push(rel); continue; }
    if (mode !== "update" || !chosen(rec.module, rel)) { deferredDrops.push(rel); continue; }
    assertInside(target, rel);
    const st = lstat(path.join(target, rel));
    if (!st) continue; // already gone
    if (st.isFile() && sha256(fs.readFileSync(path.join(target, rel), "utf8")) === rec.sha256) removed.push(rel);
    else dropped.push(rel);
  }

  // 6. the manifest as it will be once the plan is applied. The kit it names
  // is the one every file is in step with: a partial update keeps the old one.
  const partial = [...files.values()].some((f) => f.action === "deferred") || fragments.some((fr) => fr.status === "deferred") || (mode === "update" && deferredDrops.length > 0);
  const self = fs.realpathSync(target) === fs.realpathSync(kit.root); // the kit installed at its own root: its commit cannot name itself
  const stamp = { name: kit.name, version: kit.version, ...(kit.commit && !self ? { commit: kit.commit } : {}) };
  const manifest = { kit: partial && previous?.kit ? previous.kit : stamp, modules: selected, values, files: {}, fragments: [] };
  for (const [rel, f] of files) {
    if (f.seed) { if (f.action !== "conflict" && (f.action !== "deferred" || previous?.files?.[rel])) manifest.files[rel] = { module: f.module, seed: true }; continue; }
    if (["create", "same", "update", "overwrite", "adopted", "merge"].includes(f.action)) manifest.files[rel] = { module: f.module, sha256: sha256(f.content) };
    else if (previous?.files?.[rel]) manifest.files[rel] = previous.files[rel]; // outdated / conflict / deferred: what was installed is still what is recorded
  }
  for (const rel of deferredDrops) manifest.files[rel] = previous.files[rel]; // still on disk and still the kit's: a later update removes it
  for (const fr of fragments) if (fr.status === "done" || fr.status === "insert") manifest.fragments.push(fr.key);
  manifest.fragments.sort();
  const nowDeclined = fragments.filter((fr) => fr.status === "declined" || fr.status === "declining").map((fr) => fr.key).sort();
  if (nowDeclined.length) manifest.declined = nowDeclined;

  return { target, previous, selected, added: selected.filter((id) => !(previous?.modules ?? []).includes(id)), values, files, fragments, appended, manifest, dropped, removed, deferredDrops, mode };
}

// Deletes one file; the directories it leaves empty go with it, never the
// project root.
function unlink(target, rel) {
  fs.rmSync(path.join(target, rel));
  for (let dir = path.dirname(path.join(target, rel)); dir !== target && dir.startsWith(target + path.sep); dir = path.dirname(dir)) {
    try { fs.rmdirSync(dir); } catch { break; }
  }
}

const WRITES = new Set(["create", "update", "overwrite", "merge"]);

export function applyPlan(plan) {
  const write = (rel, text, mode) => {
    const dest = path.join(plan.target, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text);
    if (mode !== undefined) fs.chmodSync(dest, mode);
  };
  for (const [rel, f] of plan.files) {
    if (WRITES.has(f.action)) write(rel, f.merged ?? f.patched ?? f.content, f.mode);
    else if (f.patched !== undefined && (f.action === "keep" || f.action === "same")) write(rel, f.patched); // a seed already there: only the fragment goes in
  }
  for (const [rel, a] of plan.appended) if (a.changed) write(rel, a.text);
  for (const rel of plan.removed ?? []) unlink(plan.target, rel);
  write(MANIFEST, `${JSON.stringify(plan.manifest, null, 2)}\n`);
}

// Removing modules from an installed project: the reverse of an install, for
// what the manifest recorded. Nothing the project wrote is deleted:
//   kit-owned file — deleted when it is still as installed; an edited one
//                    stays (`force` deletes it too)
//   seed           — deleted only when it is still the kit's skeleton and
//                    nothing but fragments; otherwise it is the project's
//                    and stays
//   fragment       — taken out of the seed it went into when its lines are
//                    found as inserted, once; otherwise left, and named
//   appended block — taken out when its content is the module's
// A module another installed one requires is not removed without it, and a
// module flagged "required" never is. The other modules' files are not
// touched, and the manifest keeps the kit version it named.
export function buildRemoval({ kit, target, moduleIds = [], force = false }) {
  const previous = readManifest(target);
  if (!previous) throw new Error(`${target} is not initialised (no ${MANIFEST})`);
  const gone = new Set(moduleIds);
  if (!gone.size) throw new Error("no module to remove");
  for (const id of gone) {
    if (!previous.modules.includes(id)) throw new Error(`${id} is not installed here (installed: ${previous.modules.join(", ")})`);
    if (!kit.modules.has(id)) throw new Error(`unknown module "${id}": this kit no longer ships it, so what it inserted cannot be found`);
    if (kit.modules.get(id).required) throw new Error(`${id} is always installed: the other modules stand on it`);
  }
  const remaining = previous.modules.filter((id) => !gone.has(id));
  for (const id of remaining) {
    const needs = (kit.modules.get(id)?.requires ?? []).filter((r) => gone.has(r));
    if (needs.length) throw new Error(`${id} requires ${needs.join(", ")}: remove it in the same run (--modules ${[...gone, id].join(",")}), or keep ${needs.join(", ")}`);
  }
  // the values as installed: what the fragments and blocks were rendered with
  const { values: installedValues } = resolveValues(kit, resolveSelection(kit, previous.modules), {}, previous.values, target);
  assertInside(target, MANIFEST);

  // Texts being edited, by path. A path is read once, checked like any other
  // the installer touches; null when it is not a regular file of the project.
  const texts = new Map();
  const textOf = (rel) => {
    if (!texts.has(rel)) {
      assertInside(target, rel);
      texts.set(rel, lstat(path.join(target, rel))?.isFile() ? { before: fs.readFileSync(path.join(target, rel), "utf8") } : null);
      if (texts.get(rel)) texts.get(rel).now = texts.get(rel).before;
    }
    return texts.get(rel);
  };

  // 1. fragments, out of the seeds they went into. The list comes from the
  // kit, not from the manifest's keys: a key no fragment of the kit matches is
  // a section this kit cannot find.
  const done = new Set(previous.fragments);
  const fragmentsRemoved = [], fragmentsLeft = [];
  // Last inserted, first out: a fragment may sit at a slot another one brought.
  for (const id of resolveSelection(kit, previous.modules).filter((m) => gone.has(m)).reverse()) {
    const dir = path.join(kit.modules.get(id).dir, "fragments");
    for (const rel of walk(dir).reverse()) {
      const targetRel = path.posix.dirname(rel), slot = path.posix.basename(rel, ".frag");
      const key = `${id}:${targetRel}#${slot}`;
      if (!done.delete(key)) continue;
      const t = textOf(targetRel);
      if (!t) continue; // the file is gone, and the section with it
      const out = removeFromSlot(t.now, slot, render(fs.readFileSync(path.join(dir, rel), "utf8"), installedValues, `${id}/fragments/${rel}`));
      if (out === null) fragmentsLeft.push({ key, target: targetRel, source: path.posix.join("modules", id, "fragments", rel) });
      else { t.now = out; fragmentsRemoved.push(key); }
    }
  }
  for (const key of done) if (gone.has(key.split(":")[0])) { done.delete(key); fragmentsLeft.push({ key, target: key.slice(key.indexOf(":") + 1, key.lastIndexOf("#")), source: null }); }

  // 2. the files the manifest records for these modules
  const deleted = [], keptSeeds = [], keptEdited = [];
  for (const [rel, rec] of Object.entries(previous.files).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!gone.has(rec?.module)) continue;
    assertInside(target, rel);
    const st = lstat(path.join(target, rel));
    if (!st) continue; // already gone
    if (rec.seed) {
      const src = path.join(kit.modules.get(rec.module).dir, "files", rel);
      const t = st.isFile() ? textOf(rel) : null;
      // the skeleton may also hold sections of modules that stay: they are the kit's text too
      let bare = t?.now ?? null;
      for (const key of done) {
        const [, owner, file, slot] = /^([^:]+):(.*)#([a-z0-9-]+)$/.exec(key) ?? [];
        const frag = file === rel && kit.modules.has(owner) ? path.join(kit.modules.get(owner).dir, "fragments", ...rel.split("/"), `${slot}.frag`) : null;
        if (bare === null || !frag || !walk(path.join(kit.modules.get(owner).dir, "fragments")).includes(`${rel}/${slot}.frag`)) continue;
        bare = removeFromSlot(bare, slot, render(fs.readFileSync(frag, "utf8"), installedValues, `${owner}/fragments/${rel}/${slot}.frag`)) ?? bare;
      }
      if (bare !== null && lstat(src)?.isFile() && bare === render(fs.readFileSync(src, "utf8"), installedValues, `${rec.module}/files/${rel}`)) deleted.push(rel);
      else keptSeeds.push(rel);
      continue;
    }
    const asInstalled = st.isFile() && typeof rec.sha256 === "string" && sha256(fs.readFileSync(path.join(target, rel), "utf8")) === rec.sha256;
    if (asInstalled || (force && st.isFile())) deleted.push(rel);
    else keptEdited.push(rel);
  }

  // 3. appended blocks, unless a module that stays appends under the same marker
  const blocksRemoved = [], blocksLeft = [];
  for (const id of gone) {
    const mod = kit.modules.get(id);
    for (const a of mod.append ?? []) {
      if (remaining.some((r) => (kit.modules.get(r)?.append ?? []).some((b) => b.file === a.file && b.marker === a.marker))) continue;
      const t = textOf(a.file);
      if (!t) continue;
      const res = removeBlock(t.now, a.marker, render(fs.readFileSync(path.join(mod.dir, a.from), "utf8"), installedValues, `${id}/${a.from}`), force);
      if (res === null) blocksLeft.push(`${a.file}  (# >>> ${a.marker})`);
      else if (res.changed) { t.now = res.text; blocksRemoved.push(`${a.file}  (# >>> ${a.marker})`); }
    }
  }

  // 4. what is written: the texts that changed, except the files that go. A
  // file the installer had created for its block alone goes when it is empty.
  const writes = new Map();
  for (const [rel, t] of texts) {
    if (!t || t.now === t.before || deleted.includes(rel)) continue;
    if (t.now.trim() === "" && !previous.files[rel]) deleted.push(rel);
    else writes.set(rel, t.now);
  }

  // 5. the manifest: the modules that stay, and what was recorded for them. A
  // section a staying module had put in a file that goes is forgotten with it.
  const { values } = resolveValues(kit, resolveSelection(kit, remaining), {}, previous.values, target);
  const manifest = { kit: previous.kit, modules: remaining, values, files: {}, fragments: [...done].filter((key) => !deleted.includes(key.slice(key.indexOf(":") + 1, key.lastIndexOf("#")))).sort() };
  for (const [rel, rec] of Object.entries(previous.files)) if (!gone.has(rec?.module)) manifest.files[rel] = rec;
  const declined = (previous.declined ?? []).filter((k) => typeof k === "string" && !gone.has(k.split(":")[0]));
  if (declined.length) manifest.declined = declined;

  return { target, previous, gone: [...gone], remaining, deleted: deleted.sort(), writes, keptSeeds, keptEdited, fragmentsRemoved, fragmentsLeft, blocksRemoved, blocksLeft, manifest };
}

export function applyRemoval(plan) {
  for (const [rel, text] of plan.writes) fs.writeFileSync(path.join(plan.target, rel), text);
  for (const rel of plan.deleted) unlink(plan.target, rel);
  fs.writeFileSync(path.join(plan.target, MANIFEST), `${JSON.stringify(plan.manifest, null, 2)}\n`);
}

// Counts and lists for the report.
export function summarize(plan) {
  const by = (action) => [...plan.files].filter(([, f]) => f.action === action).map(([rel]) => rel);
  return {
    created: by("create"), unchanged: by("same"), updated: [...by("update"), ...by("overwrite")], merged: by("merge"),
    fragmentsDeclined: plan.fragments.filter((f) => f.status === "declining"),
    // per module: what an adoption has to read, module by module
    byModule: plan.selected.map((id) => { const n = (action) => [...plan.files.values()].filter((f) => f.module === id && f.action === action).length; return { module: id, created: n("create"), identical: n("same"), adopted: n("adopted"), kept: n("keep"), conflicts: n("conflict") }; }), kept: by("keep"), outdated: by("outdated"), local: by("local"),
    conflicts: [...plan.files].filter(([, f]) => f.action === "conflict").map(([rel, f]) => ({ file: rel, why: f.why })),
    fragmentsInserted: plan.fragments.filter((f) => f.status === "insert").map((f) => f.key),
    fragmentsMissingSlot: plan.fragments.filter((f) => f.status === "missing-slot"),
    appended: [...plan.appended].filter(([, a]) => a.changed).map(([rel]) => rel),
    adopted: [...plan.files].filter(([, f]) => f.action === "adopted").map(([rel, f]) => ({ file: rel, module: f.module, ...f.delta })),
    dropped: plan.dropped, removed: plan.removed ?? [],
    // a partial update: what the selection left out and that is still behind the kit
    deferred: [...by("deferred"), ...plan.fragments.filter((f) => f.status === "deferred").map((f) => f.key), ...(plan.mode === "update" ? plan.deferredDrops ?? [] : [])],
    pendingRemoval: plan.mode === "update" ? [] : plan.deferredDrops ?? [],
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

// The kit's version of one file, rendered with the values given or recorded:
// what to compare a project's own version with.
export function kitVersion({ kit, target, moduleIds = [], given = {}, rel }) {
  const wanted = rel.replace(/^(\.\/)+/, "");
  const f = buildPlan({ kit, target, moduleIds, given }).files.get(wanted);
  if (!f) throw new Error(`${wanted}: none of these modules ships such a file`);
  return f.content;
}
