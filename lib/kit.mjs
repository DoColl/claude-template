// Kit loading: kit.json + modules/<id>/module.json. Reads only, never writes.
// The manifest format is documented in docs/module-authoring.md.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PHASES = ["day-1", "first-ci", "pr-flow", "on-demand"];

const ID = /^[a-z][a-z0-9-]{0,30}$/;
const KEY = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/; // no double underscore: it delimits the token
const MANIFEST_KEYS = new Set(["id", "title", "summary", "phase", "order", "required", "recommended", "requires", "placeholders", "seed", "append", "postInstall"]);

const fail = (where, msg) => { throw new Error(`${where}: ${msg}`); };
const strings = (v) => Array.isArray(v) && v.every((x) => typeof x === "string");

function checkManifest(id, m) {
  const w = `modules/${id}/module.json`;
  if (m === null || typeof m !== "object" || Array.isArray(m)) fail(w, "must be a JSON object");
  for (const k of Object.keys(m)) if (!MANIFEST_KEYS.has(k)) fail(w, `unknown key "${k}"`);
  if (m.id !== id) fail(w, `"id" must be "${id}" (the directory name)`);
  for (const k of ["title", "summary"]) if (typeof m[k] !== "string" || !m[k].trim()) fail(w, `"${k}" must be a non-empty string`);
  if (!PHASES.includes(m.phase)) fail(w, `"phase" must be one of: ${PHASES.join(", ")}`);
  if (!Number.isInteger(m.order)) fail(w, `"order" must be an integer`);
  for (const k of ["required", "recommended"]) if (m[k] !== undefined && typeof m[k] !== "boolean") fail(w, `"${k}" must be a boolean`);
  for (const k of ["requires", "seed", "postInstall"]) if (m[k] !== undefined && !strings(m[k])) fail(w, `"${k}" must be an array of strings`);
  for (const r of m.requires ?? []) if (!ID.test(r)) fail(w, `bad module id in "requires": ${r}`);
  for (const g of m.seed ?? []) if (g.startsWith("/") || /(^|\/)\.\.(\/|$)/.test(g)) fail(w, `bad seed path: ${g}`);
  if (m.placeholders !== undefined && (m.placeholders === null || typeof m.placeholders !== "object" || Array.isArray(m.placeholders))) fail(w, `"placeholders" must be an object`);
  for (const [key, spec] of Object.entries(m.placeholders ?? {})) {
    if (!KEY.test(key)) fail(w, `bad placeholder key "${key}" (UPPER_SNAKE, no double underscore)`);
    for (const k of ["prompt", "default", "pattern"]) if (typeof spec?.[k] !== "string") fail(w, `placeholder ${key} needs a "${k}" string`);
    try { new RegExp(spec.pattern); } catch { fail(w, `placeholder ${key}: "pattern" is not a valid regular expression`); }
  }
  if (m.append !== undefined && !Array.isArray(m.append)) fail(w, `"append" must be an array`);
  for (const a of m.append ?? []) {
    for (const k of ["file", "from", "marker"]) if (typeof a?.[k] !== "string" || !a[k]) fail(w, `"append" entries need a "${k}" string`);
    if (a.file.startsWith("/") || /(^|\/)\.\.(\/|$)/.test(a.file) || /(^|\/)\.\.(\/|$)/.test(a.from)) fail(w, `"append" paths must stay inside the project and the module`);
  }
}

// Sorted by (order, id): the order modules are installed and their fragments inserted.
const byOrder = (kit) => (a, b) => kit.modules.get(a).order - kit.modules.get(b).order || (a < b ? -1 : a > b ? 1 : 0);

export function loadKit(root = KIT_ROOT) {
  const meta = JSON.parse(fs.readFileSync(path.join(root, "kit.json"), "utf8"));
  if (typeof meta.name !== "string" || !/^\d+\.\d+\.\d+$/.test(meta.version ?? "")) fail("kit.json", `needs "name" and a semver "version"`);
  const dir = path.join(root, "modules");
  const modules = new Map();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    if (!ID.test(id)) fail(`modules/${id}`, "module directory names are lower-case ids (a-z, 0-9, -)");
    const file = path.join(dir, id, "module.json");
    if (!fs.existsSync(file)) fail(`modules/${id}`, "missing module.json");
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { fail(`modules/${id}/module.json`, `invalid JSON (${e.message})`); }
    checkManifest(id, manifest);
    modules.set(id, { ...manifest, dir: path.join(dir, id) });
  }
  const kit = { name: meta.name, version: meta.version, root, modules };
  for (const [id, m] of modules) for (const r of m.requires ?? []) if (!modules.has(r)) fail(`modules/${id}/module.json`, `requires unknown module "${r}"`);
  for (const id of modules.keys()) closure(kit, [id]); // throws on a cycle
  return kit;
}

function closure(kit, ids) {
  const seen = new Set();
  const visit = (id, trail) => {
    if (!kit.modules.has(id)) throw new Error(`unknown module "${id}" (run \`list\` to see the available ones)`);
    if (trail.includes(id)) throw new Error(`dependency cycle: ${[...trail, id].join(" → ")}`);
    if (seen.has(id)) return;
    seen.add(id);
    for (const r of kit.modules.get(id).requires ?? []) visit(r, [...trail, id]);
  };
  for (const id of ids) visit(id, []);
  return seen;
}

// The modules to install for a selection: the selection, what it requires, and
// every module flagged "required". Returned in install order.
export function resolveSelection(kit, ids) {
  const required = [...kit.modules.values()].filter((m) => m.required).map((m) => m.id);
  return [...closure(kit, [...required, ...ids])].sort(byOrder(kit));
}

export function listModules(kit) {
  return [...kit.modules.keys()].sort(byOrder(kit)).map((id) => {
    const { dir, ...m } = kit.modules.get(id);
    return m;
  });
}
