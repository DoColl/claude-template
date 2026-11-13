// Three-way merge of a kit file the project edited and the kit then changed.
// Needs git, and the kit as a git checkout with its history: without either,
// nothing is found and the file stays a conflict for a human.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const git = (cwd, args) => spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

// The version of `source` (a path inside the kit) that was installed: the
// commits that touched it are rendered one by one until `matches` accepts one.
// The caller's test is the hash the manifest recorded, so a base is never a
// guess. Returns the rendered text, or null.
export function findBase(kitRoot, source, renderOne, matches) {
  const top = git(kitRoot, ["rev-parse", "--show-toplevel"]);
  try { if (top.status !== 0 || fs.realpathSync(top.stdout.trim()) !== fs.realpathSync(kitRoot)) return null; } catch { return null; }
  const log = git(kitRoot, ["log", "--format=%H", "--", source]);
  if (log.status !== 0) return null;
  for (const commit of log.stdout.split("\n").filter(Boolean)) {
    const blob = git(kitRoot, ["show", `${commit}:${source}`]);
    if (blob.status !== 0) continue; // the commit that removed it
    let text;
    try { text = renderOne(blob.stdout); } catch { continue; } // a placeholder that no longer exists
    if (matches(text)) return text;
  }
  return null;
}

// Returns { text } when the two sets of changes do not overlap, { conflicts: n }
// when they do, null when git could not run. Nothing is written in the project.
export function merge3(ours, base, theirs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-merge-"));
  try {
    for (const [name, text] of [["ours", ours], ["base", base], ["theirs", theirs]]) fs.writeFileSync(path.join(dir, name), text);
    const r = git(dir, ["merge-file", "-p", "ours", "base", "theirs"]);
    if (r.error || r.status === null || r.status < 0 || r.status > 127) return null;
    return r.status === 0 ? { text: r.stdout } : { conflicts: r.status };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
