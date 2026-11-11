// Bash allowlist for the read-only / verification sub-agents — decision logic
// (docs/conventions/agent-bash-guard.md; CLI: agent-bash-guard.mjs; spec: the
// table in agent-bash-guard.test.mjs).
//
// The sub-agent is the adversary — a model steered by content it read. Only
// EXACT SHAPES are allowed, nothing is denylisted: a denylist of flags cannot
// keep up with option abbreviations (`git diff --outp=` is `--output=`). One
// mechanism for every profile: a command is a sequence of segments (split on
// | && || ; newline), each segment is an argv, each argv must match a shape.

export const PROFILES = ["readonly", "verify"];

// Environment prefixes that cannot change what a command executes.
const SAFE_PREFIX = new Set(["GIT_OPTIONAL_LOCKS=0", "LC_ALL=C", "GIT_PAGER=cat", "PAGER=cat", "NO_COLOR=1", "TZ=UTC"]);

// git read subcommands: literal flags, and value options (attached `--x=v`, or
// `-x v` / `-xv` for the single-letter ones) whose value must be inert.
const GIT_SUBS = {
  diff:           { flags: ["--stat", "--numstat", "--shortstat", "--summary", "--name-only", "--name-status", "--cached", "--staged", "-p", "--patch", "-M", "--find-renames", "--no-renames", "--relative", "-w", "-b", "--ignore-all-space", "--ignore-space-change", "--ignore-blank-lines", "-R", "--no-index"], values: ["-U", "--unified=", "--diff-filter="] },
  log:            { flags: ["--stat", "--numstat", "--shortstat", "--name-only", "--name-status", "-p", "--patch", "--oneline", "--decorate", "--no-decorate", "--graph", "--all", "--follow", "--first-parent", "--reverse", "--no-merges", "--merges", "--topo-order", "--date-order", "--abbrev-commit", "-M"], values: ["-n", "--max-count=", "--skip=", "--since=", "--until=", "--after=", "--before=", "--author=", "--committer=", "--grep=", "--format=", "--pretty=", "--date=", "--diff-filter=", "-U", "--unified=", "-S", "-G", "--abbrev="] },
  show:           { flags: ["--stat", "--numstat", "--name-only", "--name-status", "-p", "--patch", "--oneline", "--no-patch", "-s", "--abbrev-commit"], values: ["--format=", "--pretty=", "--date=", "-U", "--unified=", "--abbrev="] },
  status:         { flags: ["--porcelain", "--short", "-s", "-b", "--branch", "--ignored", "-z", "--no-renames", "--show-stash"], values: ["--untracked-files=", "--ignore-submodules="] },
  "ls-files":     { flags: ["--error-unmatch", "--others", "-o", "--exclude-standard", "--cached", "-c", "-m", "--modified", "-d", "--deleted", "-s", "--stage", "-z", "--full-name"], values: ["--exclude="] },
  "check-ignore": { flags: ["-v", "--verbose", "--no-index"], values: [] },
  "rev-parse":    { flags: ["--abbrev-ref", "--show-toplevel", "--git-dir", "--is-inside-work-tree", "--verify", "--short", "--symbolic-full-name", "--show-prefix"], values: ["--short="] },
  blame:          { flags: ["-w", "-M", "-C", "--line-porcelain", "-p", "--porcelain", "-s", "-e", "--show-email", "--show-number"], values: ["-L", "--date="] },
  grep:           { flags: ["-n", "--line-number", "-i", "--ignore-case", "-E", "--extended-regexp", "-F", "--fixed-strings", "-l", "--files-with-matches", "-c", "--count", "-w", "--word-regexp", "-h", "-H", "--cached", "--untracked", "-I"], values: ["-e", "--max-count=", "-A", "-B", "-C"], pattern: "-e" },
  "merge-base":   { flags: ["--is-ancestor", "--all"], values: [] },
  "rev-list":     { flags: ["--count", "--left-right", "--first-parent", "--no-merges", "--reverse"], values: ["-n", "--max-count=", "--since=", "--until="] },
};
const GIT_COMMON = ["--no-color", "--color=never", "--quiet", "-q"];

// Bare readers (any position in a pipeline): single-letter flags may be clustered (-rn).
const READERS = {
  cat:   { letters: "", values: [] },
  head:  { letters: "", values: ["-n", "-c"], count: true },
  tail:  { letters: "", values: ["-n", "-c"], count: true },
  wc:    { letters: "lcwm", values: [] },
  grep:  { letters: "niEFrRlcwvohHsq", values: ["-e", "-A", "-B", "-C", "--include=", "--exclude=", "--exclude-dir="], pattern: "-e" },
  ls:    { letters: "laAhR1dtr", values: [] },
  true:  { letters: "", values: [] },
  false: { letters: "", values: [] },
};
const NUMBER = /^-?\d+$/;
const SAFE_VALUE = /^[\w .\/@:^,=+*?%{}\[\]()~!-]*$/;           // option values: never $ ` ; | & < > \ ' "
const UNSAFE_PATTERN = /[$`\\<>\n\r]/;                              // grep patterns: free text minus anything a tokenizer slip could turn into a redirection or a second line
const DOTDOT = /(^|\/)\.\.(\/|$)/;
const safeArg = (a) => a.length <= 512 && !/^[-\/~$]/.test(a) && !DOTDOT.test(a) && /^[\w.\/@:^,=+*?{}\[\]~!%-]+$/.test(a);

// The gate script: exact argv. Without --offline the gate may reach the network.
const GATE_SHAPES = { "security-checks.sh": ["--offline"] };

const sameArgv = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// ---- verification shapes (the project's, from agent-bash-guard.config.json) --
// Exact argv, optionally bound to a directory: an entry with "cwd" is only
// accepted as `cd <cwd> && <argv>`. The file is as trusted as this one — it
// sits under .claude/ and is reviewed like the hook. The checks below catch
// mistakes, not malice: keep interpreters running inline code, network clients
// and package installers out of it.
const TOKEN_OK = /^[A-Za-z0-9@%+=:,.\/_-]{1,200}$/;
const DIR_OK = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
const REFUSED_HEADS = new Set(["cd", "git", "sudo"]); // cd and git have their own shapes; sudo has no place here
export const EMPTY_CONFIG = Object.freeze({ root: [], byDir: new Map(), heads: new Set() });

export function normalizeConfig(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("the config must be a JSON object");
  for (const k of Object.keys(raw)) if (k !== "verify" && k !== "$comment") throw new Error(`unknown key "${k}"`);
  const list = raw.verify ?? [];
  if (!Array.isArray(list) || list.length > 50) throw new Error('"verify" must be an array of at most 50 entries');
  const cfg = { root: [], byDir: new Map(), heads: new Set() };
  list.forEach((entry, i) => {
    const where = `verify[${i}]`;
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`${where} must be an object`);
    for (const k of Object.keys(entry)) if (k !== "argv" && k !== "cwd" && k !== "note") throw new Error(`${where}: unknown key "${k}"`);
    const { argv, cwd } = entry;
    if (!Array.isArray(argv) || argv.length < 1 || argv.length > 12 || !argv.every((a) => typeof a === "string" && TOKEN_OK.test(a))) throw new Error(`${where}.argv must be 1 to 12 plain tokens (letters, digits and @%+=:,./_- only)`);
    if (/^[-\/~]/.test(argv[0]) || argv[0].includes("=") || DOTDOT.test(argv[0]) || REFUSED_HEADS.has(argv[0])) throw new Error(`${where}.argv[0] '${argv[0]}' cannot be a verification command`);
    if (argv.slice(1).some((a) => DOTDOT.test(a) || /(^|=)[\/~]/.test(a))) throw new Error(`${where}.argv must not point outside the project`);
    if (cwd === undefined) cfg.root.push(argv);
    else {
      if (typeof cwd !== "string" || !DIR_OK.test(cwd) || DOTDOT.test(cwd) || cwd.startsWith("-") || cwd === ".") throw new Error(`${where}.cwd must be a project-relative directory`);
      cfg.byDir.set(cwd, [...(cfg.byDir.get(cwd) ?? []), argv]);
    }
    cfg.heads.add(argv[0]);
  });
  return cfg;
}

// ---- tokenising ------------------------------------------------------------
// Segments split on | && || ; newline, honouring quotes. Anything that can nest
// or spawn is rejected — the agents never need it.
//
// An unquoted `#` is rejected outright. The shell drops everything from it to
// the end of the line, QUOTES INCLUDED, while this loop would go on tracking
// them: a quote "opened" inside a comment would hide the following lines from
// the guard, and the shell would run them. No allowed shape needs a comment;
// a `#` inside quotes or after a backslash is a plain character and passes.
const COMMENT = "comments (#) are not allowed — quote the # if it is part of a pattern";
function splitSegments(src) {
  if (/\$'|\$"/.test(src)) throw new Error("$'…' / $\"…\" quoting is not allowed");
  if (/`/.test(src)) throw new Error("backticks are not allowed");
  if (/\$\(/.test(src)) throw new Error("command substitution $( ) is not allowed");
  const out = []; let cur = ""; let q = null; let op = null;
  const push = (nextOp) => { if (cur.trim()) out.push({ op, text: cur.trim() }); else if (op !== null || nextOp === null) throw new Error("empty command between operators"); cur = ""; op = nextOp; };
  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (q) { if (c === "\\" && q === '"') { cur += c + (n ?? ""); i++; continue; } cur += c; if (c === q) q = null; continue; }
    if (c === "\\") { cur += c + (n ?? ""); i++; continue; }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === "#") throw new Error(COMMENT);
    if (c === "(" || c === ")" || c === "{" || c === "}") throw new Error("subshells and brace groups are not allowed");
    if (c === "|" && n === "|") { push("||"); i++; continue; }
    if (c === "&" && n === "&") { push("&&"); i++; continue; }
    if (c === "|" && n === "&") throw new Error("|& is not allowed");
    if (c === "|") { push("|"); continue; }
    if (c === ";" || c === "\n") { push(";"); continue; }
    if (c === "&" && n !== ">" && src[i - 1] !== ">") throw new Error("background execution (&) is not allowed");
    cur += c;
  }
  if (q) throw new Error("unterminated quote");
  push(null);
  return out;
}

// argv of one segment; quotes removed. Redirections are recognised HERE, in the
// character loop that tracks quotes (never by regex): a live `<`/`>` makes the
// whole token a redirection, which must be a bare fd-dup onto 1/2 (2>&1, >&2…)
// or a truncate/append to /dev/null, with nothing quoted in it — then it is dropped.
//
// Filename expansion is refused in the same loop, for the same reason as
// comments: the shell rewrites the word after this check has read it. An
// unquoted `*`, `?` or `[` expands to the names in the directory, and a file
// called `--output=x` then reaches git as an option nobody approved. So does
// an unquoted `^` under zsh's EXTENDED_GLOB, anywhere in a word: `^x` is every
// name but x, `HEAD^` every name that begins with HEAD. A word that starts
// with an unquoted `=` is replaced by zsh with the path of the command it
// names. Empty quotes in front change nothing: zsh drops them before it looks
// at the first character, so the test is on what the word holds so far, not
// on whether a quote opened. Quoted or escaped, each is a plain character and
// passes: git and grep take their own patterns from the quoted form.
const GLOB = "unquoted glob characters (* ? [ ^) are not allowed: the shell would expand them into words this check never saw. Quote a pattern that git or grep reads itself (-- '*.md', --include='*.ts', -e '^x'), write HEAD~1 for HEAD^, and find files with the Glob tool: quoted, a pattern given to cat, head, tail, wc or ls is a file name";
const WORD_START = "a word cannot start with an unquoted = (zsh replaces =name with the path of that command, empty quotes in front or not): quote it, '=x'";
const REDIRECT_OK = /^([12]?>&[12]|(&|[12])?>{1,2}\/dev\/null)$/;
function words(segment) {
  const out = []; let cur = ""; let q = null; let had = false; let quotedPart = false; let live = false;
  const flush = () => {
    if (had) { if (live) { if (quotedPart || !REDIRECT_OK.test(cur)) throw new Error("redirections other than 2>&1 / >/dev/null are not allowed"); } else out.push(cur); }
    cur = ""; had = false; quotedPart = false; live = false;
  };
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (q) { if (c === q) q = null; else cur += c; had = true; continue; }
    if (c === "'" || c === '"') { q = c; had = true; quotedPart = true; continue; }
    if (c === "\\") { const n = segment[i + 1] ?? ""; if (n === "<" || n === ">") throw new Error("escaped redirection characters are not allowed"); cur += n; i++; had = true; quotedPart = true; continue; }
    if (/\s/.test(c)) { flush(); continue; }
    if (c === "#") throw new Error(COMMENT); // splitSegments already refuses it; the two loops must agree
    if (c === "*" || c === "?" || c === "[" || c === "^") throw new Error(GLOB);
    if (cur === "" && c === "=") throw new Error(WORD_START);
    if (c === "<" || c === ">") live = true;
    cur += c; had = true;
  }
  if (q) throw new Error("unterminated quote");
  flush();
  return out;
}

// ---- shapes ----------------------------------------------------------------
// "$CLAUDE_PROJECT_DIR"/x (quotes already stripped) and the resolved root map to x.
function projectRelative(tok) {
  const m = /^\$CLAUDE_PROJECT_DIR\/(.*)$/.exec(tok); if (m) return m[1];
  const root = (process.env.CLAUDE_PROJECT_DIR || "").replace(/\/$/, "");
  return root && tok.startsWith(root + "/") ? tok.slice(root.length + 1) : tok;
}

// Shared option walker: literal flags, value options, clusters; returns the positional args or an error string.
// git reads the value of -U only attached (-U5): its value is optional, so a bare -U is a whole option and the
// next word is parsed on its own — `git diff -U --output=x` writes x. Such an option never takes the next word.
const ATTACHED_ONLY = ["-U"];
function walkOptions(argv, { flags, values, letters = "", count = false, pattern = null }, who) {
  const positional = []; let patternSeen = !pattern;
  for (let k = 1; k < argv.length; k++) {
    const a = argv[k];
    if (a === "--") { positional.push(...argv.slice(k + 1)); break; }
    if (!a.startsWith("-") || (count && NUMBER.test(a))) { if (!a.startsWith("-")) positional.push(a); continue; }
    if (flags.includes(a)) continue;
    const attached = values.find(v => v.endsWith("=") ? a.startsWith(v) : a.startsWith(v) && a.length > v.length);
    const separate = values.find(v => !v.endsWith("=") && a === v && !ATTACHED_ONLY.includes(v));
    if (attached || separate) {
      const opt = attached ?? separate; const val = attached ? a.slice(opt.length) : argv[++k];
      if (val === undefined) return `${who} ${opt} needs a value`;
      if (opt === pattern) { if (UNSAFE_PATTERN.test(val)) return "unsafe pattern"; patternSeen = true; continue; }
      if (["-n", "-A", "-B", "-C", "-U", "--unified=", "--max-count="].includes(opt) && !NUMBER.test(val)) return `${who} ${opt} needs a number`;
      if (!SAFE_VALUE.test(val)) return `unsafe value for ${opt}`;
      continue;
    }
    if (letters && /^-[a-zA-Z]{1,8}$/.test(a) && [...a.slice(1)].every(ch => letters.includes(ch))) continue;
    return `${who} option '${a}' is not allowed`;
  }
  if (!patternSeen) return `${who} needs -e <pattern> (the pattern is never a bare argument)`;
  return { positional };
}

function checkGit(argv) {
  const sub = argv[1]; if (!sub) return "bare git";
  if (sub.startsWith("-")) return `git global option '${sub}' is not allowed (set GIT_PAGER=cat / GIT_OPTIONAL_LOCKS=0 as a prefix instead)`;
  const spec = Object.hasOwn(GIT_SUBS, sub) ? GIT_SUBS[sub] : null; if (!spec) return `git ${sub} is not an allowed read subcommand`;
  const r = walkOptions(argv.slice(1), { flags: [...spec.flags, ...GIT_COMMON], values: spec.values, pattern: spec.pattern ?? null, count: true }, `git ${sub}`); // count: a bare -N (git log -3)
  if (typeof r === "string") return r;
  for (const p of r.positional) if (!safeArg(p)) return `unsafe argument '${p}' (refs and project-relative paths only)`;
  return null;
}

function checkReader(argv, first) {
  const cmd = argv[0]; const spec = READERS[cmd];
  const r = walkOptions(argv, { flags: [], ...spec }, cmd);
  if (typeof r === "string") return r;
  for (const p of r.positional) if (!safeArg(projectRelative(p))) return `unsafe path '${p}' (project-relative paths only)`;
  if (cmd === "cat" && first && r.positional.length === 0) return "cat needs a file";
  return null;
}

const CD_RULE = "cd is only allowed as `cd <dir> && <command>`, for a verification command the config binds to that directory";

// verifyShapes: the argv list valid at this position (after `cd <dir> &&`, or at
// the root as long as no cd came before), or null when none is.
function checkSegment(argv, { first, profile, verifyShapes, cfg, atRoot }) {
  while (argv.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[0])) { if (!SAFE_PREFIX.has(argv[0])) return `environment prefix '${argv[0].split("=")[0]}=…' is not allowed`; argv.shift(); }
  if (!argv.length) return "empty command";
  const cmd = argv[0];
  if (cmd === "cd") return profile === "verify" ? CD_RULE : "cd is not allowed (paths are project-relative from the root)";
  if (first) {
    const gate = /^(?:\.\/)?scripts\/([^/]+)$/.exec(projectRelative(cmd));
    if (gate && Object.hasOwn(GATE_SHAPES, gate[1])) {
      if (!atRoot) return `${gate[1]} runs from the project root: after a cd, the same relative path would be another script`;
      return sameArgv(argv.slice(1), GATE_SHAPES[gate[1]]) ? null : `${gate[1]} takes exactly: ${GATE_SHAPES[gate[1]].join(" ") || "(no argument)"}`;
    }
    if (cmd === "git") return checkGit(argv);
    if (profile === "verify") {
      if (verifyShapes?.some(s => sameArgv(argv, s))) return null;
      if (cfg.heads.has(cmd)) return `'${argv.join(" ")}' is not one of the verification commands of agent-bash-guard.config.json at this position (exact arguments, and \`cd <dir> &&\` first when the entry has a "cwd")`;
    }
  }
  if (Object.hasOwn(READERS, cmd)) return checkReader(argv, first);
  return `'${cmd}' is not in the allowlist`;
}

// config: the result of normalizeConfig (verify profile only); omitted = no verification command.
export function decide(command, profile, config = EMPTY_CONFIG) {
  if (!PROFILES.includes(profile)) return { allow: false, reason: `unknown profile '${profile}'` };
  if (typeof command !== "string" || !command.trim()) return { allow: false, reason: "empty command" };
  if (command.length > 2000) return { allow: false, reason: "command too long" };
  const cfg = profile === "verify" ? config : EMPTY_CONFIG;
  try {
    const segs = splitSegments(command);
    let cdDir = null;
    for (let i = 0; i < segs.length; i++) {
      const argv = words(segs[i].text);
      if (i === 0 && profile === "verify" && argv[0] === "cd") { // the only accepted cd: first, to a configured directory, then && one of its commands
        const dir = argv.length === 2 ? projectRelative(argv[1]) : null;
        if (!(dir !== null && cfg.byDir.has(dir) && segs[1]?.op === "&&")) return { allow: false, reason: CD_RULE };
        cdDir = dir; continue;
      }
      const verifyShapes = cdDir === null ? cfg.root : i === 1 ? cfg.byDir.get(cdDir) : null; // after a cd, only the segment right behind it, and never a root command
      const why = checkSegment(argv, { first: segs[i].op !== "|", profile, verifyShapes, cfg, atRoot: cdDir === null });
      if (why) return { allow: false, reason: `${why} — in: ${segs[i].text.slice(0, 80)}` };
    }
    return { allow: true };
  } catch (e) { return { allow: false, reason: e.message }; }
}
