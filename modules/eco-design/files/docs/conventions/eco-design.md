# Eco-design

**Rule (CLAUDE.md § Key conventions):** the `green-claude` plugin is pinned at a reviewed commit like every plugin. Its rules never outrank `CLAUDE.md`, security or what was asked: state the trade-off in one sentence, then deliver. An audit hit is a candidate, confirmed in context before it is reported; a dismissed one is recorded in `.green-claude/decisions.md` by a human, with its reason.

## Status

Written for the kit from a reading of the plugin's repository at the commit named under Sources. **Never run live by the kit's authors**: the plugin was not installed, its audit script was not executed, and no session was observed with the skill loaded. What this page says the plugin does is what its files say at that commit.

The reading covered the skill file, the hook scripts, the plugin and marketplace manifests and the licence files. It did not cover the audit script, its detectors or the rule catalogues. It is therefore not the review the plugin rule asks for: the project does its own, in full.

## Why

Code an assistant writes runs for years after the session that produced it: a query in a loop, a payload without pagination, a library imported for one function. A rule set that names those patterns, with the public reference behind each one, catches them while the code is being written rather than in production.

The kit copies none of it. The rule catalogues and the audit script change with each release of the plugin, and a copy in the kit would be behind the day after it was made. The harness already has the place for third-party session code: a plugin, read at a fixed commit and pinned there (`security-review.md` § Plugins). This module adds only what is specific to this plugin.

## Details

### What the plugin is

One skill, `green-claude`, from the repository under Sources. At the commit read:

- rule catalogues in JSON, in English: cross-cutting rules mapped to RGESN and GR491, rules per language and framework, practices for the session itself and token-sobriety rules;
- `scripts/eco-audit.sh`, a deterministic audit in Bash and awk that needs `jq`; it prints candidates, and `--rules <family or file>` prints the rules for one language without loading the catalogues into the session;
- the marketplace entry declares the repository root as the plugin directory, so reading "the plugin's directory in full" means reading the repository.

### What it changes in a session

The skill is written to load whenever code is written or reviewed, without being asked. Once loaded it tells the session to:

- apply the rules unprompted, and stay quiet about the ones it honoured;
- question a request before writing: the assumption that would reshape the work, the least code that solves the problem, and — when the request names a model or an AI approach — whether a smaller one would do;
- follow writing rules for its replies, and end a task that ran tools with a short report.

These are instructions of a third party arriving in every coding session. They are why the pin matters, and why the order of precedence is a rule: a convention of `CLAUDE.md`, a security requirement or an explicit request wins. The skill says the same of itself — state the trade-off in one sentence, then deliver what was asked.

### Findings are candidates

The audit matches patterns. A hit says where to look, not that there is a defect. Before a finding is reported, read the code around it; the skill's own vocabulary is the one to use:

- `FAIL` — confirmed in context;
- `REVIEW` — the pattern matched and the context does not settle it; say what would;
- `PASS` — checked and correct, stated only for a rule that was asked about.

No number of grams, joules or litres is derived from a token count or from an audit score. The plugin refuses that conversion too.

### Recorded decisions

`.green-claude/decisions.md`, at the repository root, is read by the audit: a line marked `ACCEPTED` silences one rule for one file, a line marked `TODO` keeps the finding visible. It is a derogation list, so it is handled like one:

- the file is tracked and changes to it are reviewed;
- a line is written by a human, or proposed by the session and accepted by one — never added silently;
- each `ACCEPTED` line carries its reason.

### Hooks

At the commit read, the plugin's manifest declares no hook: installing the plugin wires none. The repository ships hook scripts apart, with an installer that copies them under the user's home directory and registers them in the user's settings. Among them:

- an audit after every file write, which hands its findings back to the session;
- a reminder before a prompt that asks for code;
- a local response cache, opt-in per request.

They are per person and outside the repository: the project cannot review them in a pull request, and PL-1 does not compare them with anything. A project that wants them decides it once, for everyone, and says so here; whoever installs them reads them at the pinned commit first. The first two add text to the session on many turns, and the audit hook also runs on what a sub-agent writes.

### Setting it up

1. Read the repository at one commit, in full (`security-review.md` § Plugins): the skill file, every script under the skill, the hook scripts, the installer.
2. Register the marketplace and install the plugin by hand. Do not enable auto-update for it, and do not declare it in `.claude/settings.json` with auto-update on: an update is a new review.
3. Record `green-claude@green-claude` in `scripts/reviewed-plugins.json` with the commit read and the commit installed, then run the gate: PL-1 compares the two.
4. Install `jq` where the audit runs.

A project that reads the plugin and decides against it records it as `rejected`, with the reason, and removes this module's bullet from `CLAUDE.md`.

### Live check

In a fresh session, after the plugin is installed and recorded:

1. `./scripts/security-checks.sh --offline` — PL-1 passes on the recorded commit.
2. Ask for the eco-design rules of one language the project uses. The session must run the audit script with `--rules`, not read a catalogue whole.
3. Ask for an audit of one file with a known pattern (a `SELECT *`, a query in a loop). The finding must come back with a verdict, after the session read the code around it.
4. Add an `ACCEPTED` line for that rule and that file, audit again: the finding is hidden and the audit says that it hid one.

If one of these does not hold, this page is wrong for the version installed: correct it before relying on it.

### Limits

- Loading a skill is the model's choice: the rules apply often, not always. Nothing in the gate or in CI runs the audit.
- The plugin's version moves faster than this page. The names of files, flags and verdicts above are those of the commit read.
- The rule sets cover the web and common back-end languages; a file in a language without rules gets the cross-cutting ones only.

## Checks

- **PL-1** (`scripts/guards.d/25-plugin-pins.sh`, local only) — once recorded, the plugin is installed at its reviewed commit; recorded as `rejected`, it is not installed.

Nothing checks that the plugin is recorded at all, that its rules were applied to a change, or who wrote a line of `.green-claude/decisions.md`: the first is a post-install step, the last two are for the review of the pull request.

## Sources

- [Institut-du-Numerique-Responsable/green-claude](https://github.com/Institut-du-Numerique-Responsable/green-claude) — Apache-2.0 for code, CC BY 4.0 for rules and documentation — read at `bc2a1cf` (2026-11-13). Taken: the description of what the plugin does, its verdict vocabulary and the format of its decisions file, restated. No text, rule or script copied.

## History

- Installed with the kit.
