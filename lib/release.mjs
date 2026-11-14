// The kit's own releases (bin/release.mjs): the changelog fragments waiting
// under changes/, the version they lead to and the CHANGELOG.md entry they
// make. Reads and pure functions; bin/release.mjs writes. The format of a
// fragment is described at the top of CHANGELOG.md.
import fs from "node:fs";
import path from "node:path";
import { parseEntries } from "./changelog.mjs";

export const FRAGMENTS = "changes";
export const LEVELS = ["patch", "minor", "major"];
const NAME = /^[a-z0-9][a-z0-9-]*\.md$/;
const NOTHING = /^By hand: nothing\./; // as lib/changelog.mjs reads an entry

// One fragment → { level, body, byHand, nothing, step, remark }:
//
//   bump: patch|minor|major
//   <blank line>
//   the lines of the entry
//   <blank line>
//   By hand: <a sentence>, and whatever follows, to the end of the file
//
// "By hand: nothing." when an installed project has nothing to do beyond
// `update`; what follows that sentence is a remark, as in CHANGELOG.md.
// A line that starts with "By hand" opens that part and nothing else, since
// the changelog is read that way; and no heading, since the release writes the
// entry's own. Throws on the first rule broken.
export function parseFragment(text) {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\s+$/, "").split("\n");
  const bump = /^bump: (patch|minor|major)[ \t]*$/.exec(lines[0]);
  if (!bump) throw new Error('the first line is "bump: patch", "bump: minor" or "bump: major"');
  if (lines.length < 2 || lines[1].trim()) throw new Error("a blank line follows the bump line");
  const marks = lines.flatMap((line, i) => (/^By hand\b/.test(line) ? [i] : []));
  if (!marks.length) throw new Error('the last paragraph starts with "By hand:" ("By hand: nothing." when an installed project has nothing to do beyond `update`)');
  if (marks.length > 1) throw new Error(`lines ${marks.map((i) => i + 1).join(", ")} start with "By hand": only the last paragraph does (in CHANGELOG.md a second one reads as an entry that lost its heading)`);
  const at = marks[0];
  if (!/^By hand: \S/.test(lines[at])) throw new Error(`line ${at + 1}: the part starts with "By hand: " and a sentence on the same line`);
  if (lines[at - 1].trim()) throw new Error(`line ${at + 1}: a blank line comes before the "By hand:" paragraph`);
  const body = lines.slice(2, at).join("\n").trim();
  if (!body) throw new Error('the lines of the entry go between the bump line and the "By hand:" paragraph');
  let fence = false;
  for (const [i, line] of lines.entries()) {
    if (/^ {0,3}(```|~~~)/.test(line)) fence = !fence;
    else if (/^## \d/.test(line) || (!fence && /^ {0,3}#{1,6}(\s|$)/.test(line))) throw new Error(`line ${i + 1}: no heading in a fragment, the release writes the entry's own`);
  }
  const byHand = lines.slice(at).join("\n").trim();
  const nothing = NOTHING.test(byHand);
  return { level: bump[1], body, byHand, nothing, step: nothing ? "" : byHand.slice("By hand:".length).trim(), remark: nothing ? byHand.replace(NOTHING, "").trim() : "" };
}

// The fragments waiting in <root>/changes/, in the order they go into the
// entry: the highest level first, then by file name. Throws an Error that
// lists every problem found, one line each.
export function readFragments(root) {
  const dir = path.join(root, FRAGMENTS);
  let listing;
  try { listing = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { if (e.code === "ENOENT") return []; throw e; }
  const found = [], problems = [];
  for (const entry of listing.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.name === ".DS_Store") continue;
    const file = `${FRAGMENTS}/${entry.name}`;
    if (!entry.isFile() || !NAME.test(entry.name)) { problems.push(`${file}: not a fragment — ${FRAGMENTS}/ holds <slug>.md files only, the slug in a-z, 0-9 and -`); continue; }
    try { found.push({ file, ...parseFragment(fs.readFileSync(path.join(dir, entry.name), "utf8")) }); } catch (e) { problems.push(`${file}: ${e.message}`); }
  }
  if (problems.length) throw new Error(problems.join("\n"));
  return found.sort((a, b) => LEVELS.indexOf(b.level) - LEVELS.indexOf(a.level) || (a.file < b.file ? -1 : 1));
}

export const highestLevel = (fragments) => LEVELS[Math.max(...fragments.map((f) => LEVELS.indexOf(f.level)))];

export function nextVersion(version, level) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? "");
  if (!m || !LEVELS.includes(level)) throw new Error(`no next version for "${version}" at level "${level}"`);
  const [x, y, z] = m.slice(1).map(Number);
  return { major: `${x + 1}.0.0`, minor: `${x}.${y + 1}.0`, patch: `${x}.${y}.${z + 1}` }[level];
}

// The one "By hand" part of an entry made of several fragments: the steps of
// the fragments that have one, as written when there is one, as a list when
// there are several; then the remarks that follow "By hand: nothing." in the
// others, so that nothing a fragment says is lost. With no step at all, the
// part starts "By hand: nothing." and `update` lists no step for the version.
export function byHandPart(fragments) {
  const steps = fragments.filter((f) => !f.nothing);
  const remarks = fragments.filter((f) => f.nothing && f.remark).map((f) => f.remark);
  if (!steps.length) return remarks.length ? [`By hand: nothing. ${remarks[0]}`, ...remarks.slice(1)].join("\n\n") : "By hand: nothing.";
  const head = steps.length === 1 ? steps[0].byHand : ["By hand:", "", ...steps.map((f) => `- ${f.step.replace(/\n(?=.)/g, "\n  ")}`)].join("\n");
  return [head, ...remarks].join("\n\n");
}

const lastParagraph = (text) => text.split(/\n[ \t]*\n/).pop();

// "## <version>", the fragments' lines in their order (a list that goes on
// from one fragment to the next stays one list), then the one "By hand" part.
export function composeEntry(version, fragments) {
  if (!fragments.length) throw new Error("no fragment, no entry");
  let body = "";
  for (const f of fragments) body = body ? `${body}${/^- /.test(lastParagraph(body)) && /^- /.test(f.body) ? "\n" : "\n\n"}${f.body}` : f.body;
  return `## ${version}\n\n${body}\n\n${byHandPart(fragments)}\n`;
}

// CHANGELOG.md with `entry` above its first entry, the header untouched.
// Refused when the first entry is not the current version. The result must
// read back as one more entry, the new one first, every entry with exactly
// one "By hand" part: what lib/changelog.mjs and the tests expect.
export function insertEntry(changelog, entry, current) {
  const at = changelog.search(/^## \d+\.\d+\.\d+/m);
  if (at === -1) throw new Error("CHANGELOG.md has no entry yet: the first one is written by hand");
  const first = /^## (\d+\.\d+\.\d+)/.exec(changelog.slice(at))[1];
  if (first !== current) throw new Error(`CHANGELOG.md starts with ${first} and kit.json says ${current}: settle that first`);
  const text = `${changelog.slice(0, at)}${entry}\n${changelog.slice(at)}`;
  const version = /^## (\d+\.\d+\.\d+)/.exec(entry)?.[1];
  const before = parseEntries(changelog), after = parseEntries(text);
  const parts = text.split(/^(?=## \d)/m).filter((b) => /^## \d/.test(b)).map((b) => (b.match(/^By hand\b/gm) ?? []).length);
  if (!version || after.length !== before.length + 1 || after[0].version !== version || after[0].byHand === null || parts.some((n) => n !== 1)) throw new Error(`the entry for ${version} would not read back as one entry with one "By hand" part`);
  return text;
}

// A JSON file's text with its top-level "version" changed from `from` to
// `to`, and nothing else: the file keeps its layout.
export function setVersion(text, from, to, file) {
  const data = JSON.parse(text);
  if (data.version !== from) throw new Error(`${file} says version ${data.version} and kit.json ${from}: settle that first`);
  const next = text.replace(new RegExp(`("version"\\s*:\\s*")${from.replaceAll(".", "\\.")}"`), `$1${to}"`);
  if (JSON.stringify(JSON.parse(next)) !== JSON.stringify({ ...data, version: to })) throw new Error(`${file}: the version could not be changed alone`);
  return next;
}
