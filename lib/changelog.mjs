// The "By hand" part of the kit's CHANGELOG.md entries: what an update of an
// installed project does not do by itself (seeds never follow the kit).
import fs from "node:fs";
import path from "node:path";

const parts = (v) => v.split(".").map(Number);
const cmp = (a, b) => { const x = parts(a), y = parts(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };

// [{ version, byHand }] for every entry, newest first as the file has them;
// byHand is null when the entry has no such part, "" when it starts with
// "By hand: nothing." — what follows that sentence is a remark, not a step.
export function entries(kitRoot) {
  let text;
  try { text = fs.readFileSync(path.join(kitRoot, "CHANGELOG.md"), "utf8"); } catch { return []; }
  const out = [];
  for (const block of text.split(/^(?=## \d+\.\d+\.\d+)/m).slice(1)) {
    const version = /^## (\d+\.\d+\.\d+)/.exec(block)[1];
    const at = block.search(/^By hand\b/m);
    const body = at === -1 ? null : block.slice(at).trim();
    out.push({ version, byHand: body === null ? null : /^By hand: nothing\./.test(body) ? "" : body });
  }
  return out;
}

// The steps of the versions after `from`, up to `to`, oldest first.
export function byHandBetween(kitRoot, from, to) {
  if (!/^\d+\.\d+\.\d+$/.test(from ?? "") || !/^\d+\.\d+\.\d+$/.test(to ?? "")) return [];
  return entries(kitRoot).filter((e) => e.byHand && cmp(e.version, from) > 0 && cmp(e.version, to) <= 0).sort((a, b) => cmp(a.version, b.version));
}
