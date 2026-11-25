// Text operations of the installer: placeholders, slots, appended blocks.
// All pure functions (string in, string out).

// __HARNESS_<KEY>__ — plain identifiers, so they are inert in YAML, shell,
// JSON and Markdown, and cannot collide with GitHub's ${{ … }} expressions.
const TOKEN = /__HARNESS_([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*)__/g;

export function tokensIn(text) {
  return [...new Set([...text.matchAll(TOKEN)].map((m) => m[1]))];
}

// Replaces every token; an undeclared one is a kit bug and throws.
export function render(text, values, where) {
  return text.replace(TOKEN, (token, key) => {
    if (!Object.hasOwn(values, key)) throw new Error(`${where}: placeholder ${token} is not declared by the module or a module it requires`);
    return values[key];
  });
}

// A slot is a line containing `harness:slot <name>` or `harness:rows <name>`,
// inside whatever comment syntax the file uses. The fragment is inserted above
// that line, which stays in place so a module added later finds it again.
//   slot — a block (section, paragraph): followed by one blank line
//   rows — contiguous lines (table rows, list items): no blank line
// Returns the new text, or null when the file has no such slot.
export function insertAtSlot(text, name, fragment) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`bad slot name "${name}"`);
  const marker = new RegExp(`harness:(slot|rows) ${name}(?![a-z0-9-])`);
  const lines = text.split("\n");
  const at = lines.findIndex((line) => marker.test(line));
  if (at === -1) return null;
  const kind = marker.exec(lines[at])[1];
  const body = fragment.replace(/\s+$/, "").split("\n");
  lines.splice(at, 0, ...body, ...(kind === "slot" ? [""] : []));
  return lines.join("\n");
}

// The inverse of insertAtSlot, for a module that is removed: the fragment's
// lines are taken out, with the blank line that followed a `slot` block. Only
// when they are found exactly once, as they were inserted; null otherwise — a
// section the project rewrote, or one the kit changed since, is not guessed at.
export function removeFromSlot(text, name, fragment) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`bad slot name "${name}"`);
  const body = fragment.replace(/\s+$/, "").split("\n");
  const lines = text.split("\n");
  const found = [];
  for (let i = 0; i + body.length <= lines.length; i++) if (body.every((line, j) => lines[i + j] === line)) found.push(i);
  if (found.length !== 1) return null;
  const at = found[0], after = at + body.length;
  const marker = new RegExp(`harness:(slot|rows) ${name}(?![a-z0-9-])`).exec(text);
  // without its marker the kind is unknown: the blank line goes only when another one stands above
  const blank = lines[after] === "" && (marker ? marker[1] === "slot" : at === 0 || lines[at - 1] === "");
  lines.splice(at, body.length + (blank ? 1 : 0));
  return lines.join("\n");
}

export function slotsIn(text) {
  return [...text.matchAll(/harness:(?:slot|rows) ([a-z0-9-]+)/g)].map((m) => m[1]);
}

// Appends a block between `# >>> <marker>` / `# <<< <marker>` lines unless the
// opening line is already there. For files whose comments start with `#`
// (.gitignore). Idempotent.
export function appendBlock(text, marker, block) {
  const begin = `# >>> ${marker}`;
  if (text.split("\n").includes(begin)) return { text, changed: false };
  const gap = text === "" || text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
  return { text: `${text}${gap}${begin}\n${block.replace(/\s+$/, "")}\n# <<< ${marker}\n`, changed: true };
}

// The inverse of appendBlock: the block between its two marker lines goes,
// with the blank line that set it apart. Only when its content is still
// `block` (or `force`); { text, changed: false } when the block is not there,
// null when it was edited.
export function removeBlock(text, marker, block, force = false) {
  const lines = text.split("\n");
  const begin = lines.indexOf(`# >>> ${marker}`);
  if (begin === -1) return { text, changed: false };
  const end = lines.indexOf(`# <<< ${marker}`, begin + 1);
  if (end === -1) return null;
  if (!force && lines.slice(begin + 1, end).join("\n") !== block.replace(/\s+$/, "")) return null;
  const from = begin > 0 && lines[begin - 1] === "" ? begin - 1 : begin;
  lines.splice(from, end - from + 1);
  return { text: lines.join("\n"), changed: true };
}
