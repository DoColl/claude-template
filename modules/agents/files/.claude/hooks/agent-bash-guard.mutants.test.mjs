// node --test .claude/hooks/agent-bash-guard.mutants.test.mjs — the specification (agent-bash-guard.test.mjs)
// run against broken copies of the lib (docs/conventions/agent-bash-guard.md § Mutants).
//
// A row that only restates what the guard already refuses proves nothing about the condition it was written
// for: delete the condition and some other check may still refuse the row, or no row may need it at all. Each
// mutant below is one find-and-replace on the lib's source that loosens one condition (deletes it, drops an
// anchor, makes a character optional, widens a class), with the test of the specification and the row in it
// that must catch it. For each mutant, the specification is run on a copy of the hooks with the mutated lib,
// restricted to that test; it must fail, and its failure must name that row.
//
// The list cannot rot silently: a find string that no longer occurs exactly once in the lib fails, as does a
// mutant the specification survives, and a test name that selects no test. When the lib changes, update the
// mutants it touches; when a condition is added, add its mutant and the row that catches it.
//
// A check that another one backs up has no mutant, as no row can show its removal. Remove the backup, and the
// first check needs its mutant and its row:
// - the backtick, $( ) and $'…' / $"…" refusals: no value class or argument takes a backtick or a $ followed by
//   ( ' ";
// - the two comment refusals, each backing the other; without both, a comment can still not hide a line, since no
//   value, argument or pattern takes a newline;
// - |& (the & refusal), an unterminated quote in splitSegments (words() refuses it too);
// - the git global-option check and the git subcommand's own-property lookup (the lookup refuses an option, and an
//   inherited subcommand crashes the option walk, which fails closed);
// - the escaped redirection characters (no argument class takes < or >);
// - the readonly profile's empty config and the profile test in checkSegment, each backing the other;
// - a cwd starting with - in the config (the `./` before it keeps it a path).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = "agent-bash-guard-lib.mjs";
const COPIED = ["agent-bash-guard.mjs", "agent-bash-guard.test.mjs", "agent-bash-guard.config.json"];

// The tests of the specification, by name. Each prints every row it gets wrong on its own line, as
// `should <verdict>: <the row as JSON>`.
const RO_BLOCK = "readonly blocks everything else (writes, network, other programs, smuggling), config or not";
const RO_ALLOW = "readonly allows the inspection shapes";
const V_BLOCK = "verify blocks variations of the configured commands";
const CONFIG = "the config accepts exact argv entries only";

// { what, find, replace, test, row }: `row` is a command of the test's table (a config object for CONFIG).
const MUTANTS = [
  // ---- the cd form: `cd ./<cwd> && <command>`, exactly — the five conditions a review found unexercised
  { what: "cd: the end of the match is not anchored", find: "+)$/.exec(segs[0].text)", replace: "+)/.exec(segs[0].text)", test: V_BLOCK, row: "cd ./backend'/../..' && npm test" },
  { what: "cd: the start of the match is not anchored", find: "/^cd \\.\\/([", replace: "/cd \\.\\/([", test: V_BLOCK, row: "cd cd ./backend && npm test" },
  { what: "cd: the dot of ./ matches any character", find: "/^cd \\.\\/([", replace: "/^cd .\\/([", test: V_BLOCK, row: "cd ~/backend && npm test" },
  { what: "cd: the dot of ./ is optional", find: "/^cd \\.\\/([", replace: "/^cd \\.?\\/([", test: V_BLOCK, row: "cd /backend && npm test" },
  { what: "cd: the slash of ./ is optional", find: "/^cd \\.\\/([", replace: "/^cd \\.\\/?([", test: V_BLOCK, row: "cd .backend && npm test" },
  { what: "cd: the directory is not checked against the config", find: "dir !== undefined && cfg.byDir.has(dir) && ", replace: "dir !== undefined && ", test: V_BLOCK, row: "cd ./.. && ls" },
  { what: "cd: a later segment may be a cd", find: "if (i === 0 && profile === \"verify\" && argv[0] === \"cd\")", replace: "if (profile === \"verify\" && argv[0] === \"cd\")", test: V_BLOCK, row: "cd ./backend && cd /etc && cat passwd" },
  { what: "cd: something other than && may follow", find: " && segs[1]?.op === \"&&\"", replace: "", test: V_BLOCK, row: "cd ./backend || npm test" },
  { what: "cd: a cd alone is accepted", find: " && segs[1]?.op === \"&&\"", replace: " && segs[1]?.op !== \"||\"", test: V_BLOCK, row: "cd ./backend" },
  // ---- what runs after the cd, and where
  { what: "after a cd, every later segment gets the directory's commands", find: "i === 1 ? cfg.byDir.get(cdDir) : null", replace: "cfg.byDir.get(cdDir)", test: V_BLOCK, row: "cd ./backend && npm test && npm run build" },
  { what: "after a cd, a root command is accepted", find: "i === 1 ? cfg.byDir.get(cdDir) : null", replace: "i === 1 ? [...cfg.root, ...cfg.byDir.get(cdDir)] : null", test: V_BLOCK, row: "cd ./backend && make check" },
  { what: "at the root, a directory's command is accepted", find: "cdDir === null ? cfg.root :", replace: "cdDir === null ? [...cfg.root, ...[...cfg.byDir.values()].flat()] :", test: V_BLOCK, row: "npm test" },
  { what: "the gate script runs after a cd", find: "if (!atRoot) return", replace: "if (false) return", test: V_BLOCK, row: "cd ./backend && ./scripts/security-checks.sh --offline" },
  { what: "a shorter argv passes for the configured one", find: "a.length === b.length && a.every", replace: "a.every", test: V_BLOCK, row: "cargo test" },
  { what: "a verification command may be fed by a pipe", find: "first: segs[i].op !== \"|\"", replace: "first: true", test: V_BLOCK, row: "git status | make check" },
  // ---- the characters and words the shell reads differently
  { what: "whitespace the shell does not split on is accepted", find: "if (/[^\\S \\t\\n]/.test(command)) return", replace: "if (false) return", test: V_BLOCK, row: "go test\v./..." },
  { what: "a NUL is accepted", find: "if (command.includes(\"\\0\")) return", replace: "if (false) return", test: RO_BLOCK, row: "grep -e 'a\u0000b' f" },
  { what: "a backslash or | after a non-ASCII character is accepted", find: "if (/[^\\x00-\\x7f][\\\\|]/.test(command)) return", replace: "if (false) return", test: RO_BLOCK, row: "git grep -n -e 中|cat f" },
  { what: "an unquoted glob character is accepted", find: "if (c === \"*\" || c === \"?\" || c === \"[\" || c === \"^\") throw new Error(GLOB);", replace: "", test: RO_BLOCK, row: "cat *" },
  { what: "an unquoted ^ is accepted", find: "c === \"[\" || c === \"^\")", replace: "c === \"[\")", test: RO_BLOCK, row: "git diff HEAD^ HEAD" },
  { what: "a segment may run in the background", find: "    if (c === \"&\" && n !== \">\" && src[i - 1] !== \">\") throw new Error(\"background execution (&) is not allowed\");\n", replace: "", test: RO_BLOCK, row: "grep -e x&touch pwn" },
  { what: "a brace is accepted", find: "if (c === \"(\" || c === \")\" || c === \"{\" || c === \"}\") throw", replace: "if (c === \"(\" || c === \")\") throw", test: RO_BLOCK, row: "git diff HEAD {--output=pwn,HEAD}" },
  { what: "a parenthesis is accepted", find: "if (c === \"(\" || c === \")\" || c === \"{\" || c === \"}\") throw", replace: "if (c === \"{\" || c === \"}\") throw", test: RO_BLOCK, row: "git log -S README.md(e:'touch pwn':)" },
  { what: "a redirection may hold a quoted part", find: "if (quotedPart || !REDIRECT_OK.test(cur))", replace: "if (!REDIRECT_OK.test(cur))", test: RO_BLOCK, row: "cat f 2>'&1'" },
  { what: "an empty segment between operators is accepted", find: " else if (op !== null || nextOp === null) throw new Error(\"empty command between operators\");", replace: "", test: V_BLOCK, row: "git status |\nmake check" },
  { what: "a word may start with an unquoted =", find: "if (cur === \"\" && c === \"=\") throw new Error(WORD_START);", replace: "", test: RO_BLOCK, row: "cat =ls" },
  { what: "a redirection target is not anchored at its end", find: "\\/dev\\/null)$/", replace: "\\/dev\\/null)/", test: RO_BLOCK, row: "cat f 2>/dev/null/x" },
  { what: "a redirection is not anchored at its start", find: "const REDIRECT_OK = /^(", replace: "const REDIRECT_OK = /(", test: RO_BLOCK, row: "cat f >pwn2>&1" },
  { what: "an environment prefix is not checked", find: "if (!SAFE_PREFIX.has(argv[0])) return", replace: "if (false) return", test: RO_BLOCK, row: "GIT_EXTERNAL_DIFF=./evil.sh git diff" },
  // ---- arguments and option values
  { what: "a path may climb out with ..", find: "!/^[-\\/~$]/.test(a) && !DOTDOT.test(a) && ", replace: "!/^[-\\/~$]/.test(a) && ", test: RO_BLOCK, row: "git diff -- ../other/file" },
  { what: "a path may be absolute", find: "!/^[-\\/~$]/.test(a)", replace: "!/^[-~$]/.test(a)", test: RO_BLOCK, row: "git diff /etc/passwd" },
  { what: "a path may end in ..", find: "const DOTDOT = /(^|\\/)\\.\\.(\\/|$)/;", replace: "const DOTDOT = /(^|\\/)\\.\\.\\//;", test: RO_BLOCK, row: "ls .." },
  { what: "a path is not anchored at its end", find: "/^[\\w.\\/@:^,=+*?{}\\[\\]~!%-]+$/.test(a)", replace: "/^[\\w.\\/@:^,=+*?{}\\[\\]~!%-]+/.test(a)", test: RO_BLOCK, row: "cat .$IFS/etc/passwd" }, // bash splits the word on $IFS; zsh does not, by default
  { what: "a gate script is looked up through the prototype", find: "if (gate && Object.hasOwn(GATE_SHAPES, gate[1]))", replace: "if (gate && gate[1] in GATE_SHAPES)", test: RO_BLOCK, row: "scripts/toString" },
  { what: "an option value may hold a ;", find: "const SAFE_VALUE = /^[\\w .", replace: "const SAFE_VALUE = /^[\\w ;.", test: RO_BLOCK, row: "git log -n 5 --format='%h; rm x'" },
  { what: "a grep pattern may hold a $", find: "const UNSAFE_PATTERN = /[$`", replace: "const UNSAFE_PATTERN = /[`", test: RO_BLOCK, row: "git grep -e '$x' f" },
  { what: "-U takes the next word as its value", find: "const ATTACHED_ONLY = [\"-U\"];", replace: "const ATTACHED_ONLY = [];", test: RO_BLOCK, row: "git diff -U 5 HEAD" },
  { what: "a count option takes any value", find: ".includes(opt) && !NUMBER.test(val)) return", replace: ".includes(opt) && false) return", test: RO_BLOCK, row: "git log -n x" },
  { what: "git grep takes a bare pattern", find: "if (!patternSeen) return", replace: "if (false) return", test: RO_BLOCK, row: "git grep -n foo" },
  { what: "a reader is looked up through the prototype", find: "if (Object.hasOwn(READERS, cmd)) return checkReader", replace: "if (cmd in READERS) return checkReader", test: RO_BLOCK, row: "__proto__ x" },
  { what: "cat reads standard input", find: "if (cmd === \"cat\" && first && r.positional.length === 0) return", replace: "if (false) return", test: RO_BLOCK, row: "cat" },
  // ---- the verification config
  { what: "config: cd may be a verification command", find: "new Set([\"cd\", \"git\", \"sudo\"])", replace: "new Set([\"git\", \"sudo\"])", test: CONFIG, row: { verify: [{ argv: ["cd", "x"] }] } },
  { what: "config: an argument may climb out with ..", find: "if (argv.slice(1).some((a) => DOTDOT.test(a) || ", replace: "if (argv.slice(1).some((a) => ", test: CONFIG, row: { verify: [{ argv: ["make", "../x"] }] } },
  { what: "config: an argument may be absolute", find: "DOTDOT.test(a) || /(^|=)[\\/~]/.test(a)", replace: "DOTDOT.test(a) || /(^|=)~/.test(a)", test: CONFIG, row: { verify: [{ argv: ["make", "/etc/x"] }] } },
  { what: "config: a token may hold a ;", find: "const TOKEN_OK = /^[A-Za-z0-9", replace: "const TOKEN_OK = /^[;A-Za-z0-9", test: CONFIG, row: { verify: [{ argv: ["npm", "test;rm"] }] } },
  { what: "config: the cwd may be .", find: " || cwd === \".\")", replace: ")", test: CONFIG, row: { verify: [{ argv: ["make"], cwd: "." }] } },
  { what: "config: the cwd may hold a space", find: "const DIR_OK = /^[A-Za-z0-9._-]+", replace: "const DIR_OK = /^[A-Za-z0-9._ -]+", test: CONFIG, row: { verify: [{ argv: ["make"], cwd: "a b" }] } },
];

const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const occurrences = (hay, needle) => hay.split(needle).length - 1;

function stage(libSource) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-bash-guard-mutant-"));
  const hooks = path.join(dir, ".claude", "hooks");
  fs.mkdirSync(hooks, { recursive: true });
  for (const f of COPIED) fs.copyFileSync(path.join(HERE, f), path.join(hooks, f));
  fs.writeFileSync(path.join(hooks, LIB), libSource);
  return { dir, spec: path.join(hooks, "agent-bash-guard.test.mjs") };
}

// Under `node --test`, NODE_TEST_CONTEXT tells a child node to report to its parent instead of printing.
const childEnv = { ...process.env, NO_COLOR: "1" };
delete childEnv.NODE_TEST_CONTEXT; delete childEnv.FORCE_COLOR;

function runSpec(libSource, testName) {
  const { dir, spec } = stage(libSource);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--test", "--test-reporter=spec", `--test-name-pattern=^${reEscape(testName)}$`, spec], { cwd: dir, env: childEnv });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    child.on("close", (status) => { fs.rmSync(dir, { recursive: true, force: true }); resolve({ status, out, count: (k) => Number(new RegExp(`^ℹ ${k} (\\d+)$`, "m").exec(out)?.[1] ?? NaN) }); });
  });
}

const source = fs.readFileSync(path.join(HERE, LIB), "utf8");

test("the mutant list is well formed", () => {
  const names = MUTANTS.map((m) => m.what);
  assert.equal(new Set(names).size, names.length, "two mutants share a description");
  for (const m of MUTANTS) {
    assert.ok(m.find && m.find !== m.replace, `${m.what}: the find and replace strings must differ`);
    assert.ok([RO_BLOCK, RO_ALLOW, V_BLOCK, CONFIG].includes(m.test), `${m.what}: unknown test '${m.test}'`);
  }
});

test("the specification passes on the lib as it is, test by test", { concurrency: true }, async (t) => {
  await Promise.all([...new Set(MUTANTS.map((m) => m.test))].map((name) => t.test(name, async () => {
    const r = await runSpec(source, name);
    assert.equal(r.status, 0, `the unmutated lib fails '${name}':\n${r.out}`);
    assert.equal(r.count("pass"), 1, `the name selects exactly one test of the specification: '${name}'\n${r.out}`);
  })));
});

test("the specification fails on every mutant, on the row it names", { concurrency: true }, async (t) => {
  await Promise.all(MUTANTS.map((m) => t.test(m.what, async () => {
    const n = occurrences(source, m.find);
    assert.equal(n, 1, `the find string occurs ${n} time(s) in ${LIB}, not once: the lib changed, update this mutant\n  find: ${JSON.stringify(m.find)}`);
    const r = await runSpec(source.replace(m.find, () => m.replace), m.test);
    assert.notEqual(r.status, 0, `the specification survives the mutant (test '${m.test}' passes)`);
    assert.equal(r.count("fail"), 1, `the mutant must fail the test it names, '${m.test}', and nothing else stop it\n${r.out}`);
    const row = typeof m.row === "string" ? JSON.stringify(m.row) : JSON.stringify(m.row).slice(0, 120);
    const named = r.out.split("\n").some((l) => /should [a-z ,]+: /.test(l) && l.includes(`: ${row}`));
    assert.ok(named, `the specification fails, but not on the row this mutant names: ${row}\n${r.out}`);
  })));
});
