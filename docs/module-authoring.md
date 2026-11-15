# Writing a module

A module is a directory under `modules/`. The installer (`bin/harness.mjs`) copies its files into a project, inserts its fragments into the project's instruction files and records what it did in the project's `.claude/harness.json`. This page is the contract; `test/` enforces most of it.

```
modules/<id>/
  module.json                      manifest
  files/…                          copied to the same path in the project
  fragments/<target path>/<slot>.frag   text inserted into a seed file at a slot
  append/…                         blocks appended to #-comment files (.gitignore)
```

## module.json

```json
{
  "id": "weekly-digest",
  "title": "Weekly digest of what waits on a human",
  "summary": "One sentence shown when choosing modules.",
  "phase": "pr-flow",
  "order": 42,
  "requires": ["core"],
  "recommended": false,
  "placeholders": {
    "DEFAULT_BRANCH": { "prompt": "Default branch", "default": "main", "pattern": "[A-Za-z0-9][A-Za-z0-9._/-]{0,60}" }
  },
  "seed": ["docs/runbook/release.md"],
  "append": [{ "file": ".gitignore", "from": "append/gitignore", "marker": "claude-template:weekly-digest" }],
  "postInstall": ["What the project owner must do or fill after installing, one line each."]
}
```

- `id` is the directory name. `phase` is one of `day-1`, `first-ci`, `pr-flow`, `on-demand` (when a project typically adopts the module). `order` sorts installation and fragment insertion.
- `requires` lists modules installed along with this one. `core` is flagged `required` and always installed; list it anyway.
- `recommended` puts the module in the default day-1 selection.
- Unknown keys are rejected.

## Files: kit-owned or seed

Every file under `files/` is copied to the same relative path, with its mode (keep scripts executable).

- **Kit-owned** (the default): machinery — hooks, guards, workflows, the convention page that documents them. Recorded with a hash, so `update` refreshes a file the project has not edited and reports one it has. A kit-owned script or workflow never asks the project to edit it: no `TODO(harness)` in it (a test). What the project decides there is a placeholder, which `update --set` changes, or lives in a seed the file reads.
- **Seed** (listed in `seed`, exact path or `dir/**`): a skeleton the project fills in — `CLAUDE.md`, an index, a config. Created once, never overwritten, not even with `--force`.

Two modules never ship the same path.

## Placeholders

`__HARNESS_<KEY>__` in any file or fragment is replaced at install time. A module declares every key it uses, or relies on a module it requires to declare it. Two modules may declare the same key only with an identical spec. The `pattern` is anchored and checked before anything is written — values land in YAML, shell and Markdown, so keep patterns strict (no quotes, no `$`, no whitespace beyond a plain space).

Declared by `core`, usable by every module: `PROJECT_NAME`, `CLAUDE_MD_BUDGET`, `DEFAULT_BRANCH`.

Shared spec to copy verbatim when a module needs it:

```json
"CI_WORKFLOW": { "prompt": "Name of the CI workflow that must be green before a merge (its `name:`)", "default": "CI", "pattern": "[A-Za-z0-9][A-Za-z0-9 ._-]{0,40}" }
"LIGHT_RUNNER": { "prompt": "Runner label for the short jobs that need only bash, git, jq, the GitHub CLI and Node.js (ubuntu-latest keeps the 2-core runner; a self-hosted label works too)", "default": "ubuntu-slim", "pattern": "[A-Za-z0-9][A-Za-z0-9._-]{0,63}" }
```

What only the project can write is not a placeholder: leave a `TODO(harness): …` comment. `status` and the `90-harness-todo` guard list them.

## Fragments and slots

A seed file exposes slots: a line containing `harness:slot <name>` or `harness:rows <name>` inside a comment. A fragment `fragments/<target path>/<name>.frag` is inserted above that line the first time the module is installed (the manifest remembers it, so it is inserted once). The slot line stays, so a module added later finds it.

- `slot` — a block (a section, a paragraph). One blank line is added after it.
- `rows` — contiguous lines (table rows, list items). No blank line.

A comment line at the left margin ends a Markdown list or table. A `rows` marker therefore sits after the last row of a table, and inside a list it is indented to the items' text (three spaces under `1. `), so that it belongs to the item above it and the items on both sides stay one list.

Fragments may only target seed files. If the target file belongs to a module that is not installed, the fragment waits; if the slot line has been removed from the project's file, the installer says so and the fragment is pasted by hand.

Slots provided by `core`:

| File | Slot | Kind | For |
|---|---|---|---|
| `CLAUDE.md` | `delegation` | slot | the "Delegation" section (agents) |
| `CLAUDE.md` | `conventions` | rows | one bullet per rule: `- **Name**: rule, at most 400 bytes. → \`docs/conventions/<slug>.md\`` |
| `CLAUDE.md` | `security-workflow` | slot | paragraphs or `###` sections at the top of "Security workflow" |
| `CLAUDE.md` | `before-pushing` | rows | review passes that run before the built-in ones, each written `1. **<pass>** (tier 3)` or `(tiers 2, 3)` — the tiers of "Before pushing" it applies to |
| `CLAUDE.md` | `doc-maintenance` | rows | `- <change> → <doc>` lines |
| `docs/conventions/README.md` | `conventions-index` | rows | `| \`file.md\` | topic | source |` |

`CLAUDE.md` has a byte budget: a module's `conventions` bullet is at most 400 bytes and points to a convention page the module ships under `files/docs/conventions/`. With every module installed, what a session loads of `CLAUDE.md` stays under 60% of the default budget: the rest is the project's.

## Path-scoped rules

A rule that is about the content of files at known paths does not go in `CLAUDE.md`: the module ships `files/.claude/rules/<slug>.md`, which Claude Code loads only once a session reads, writes or edits a matching file.

```markdown
---
paths:
  - ".github/workflows/**"
---

# Topic

The rule. → `docs/conventions/<slug>.md`
```

- The frontmatter holds `paths:` and nothing else, as a list of double-quoted globs relative to the project root. Without `paths:` the file would load at launch and spend the project's budget; a glob that matches everything is refused for the same reason.
- At most 1200 bytes of rule, ending with the pointer to a convention page the module installs. That page names the rule file and the paths that load it.
- Kit-owned, never a seed: `update` refreshes it.
- Not for a rule about behaviour (what to run, what never to merge): nothing a session opens would load it in time. That is a `conventions` bullet.
- The rule reaches a session after the first write of a new file, not before. Use it for what a guard also checks.

## Guards

A module that enforces something ships a guard: `files/scripts/guards.d/NN-<name>.sh`, run by the project's gate (`scripts/security-checks.sh`) and therefore by CI.

- Bash, compatible with bash 3.2. Starts with `. "$(dirname "$0")/_lib.sh"`, reports with `ok` / `fail` / `note`, ends with `finish`. `skip "<reason>"` exits 77.
- One line per check, starting with its ID (`AM-3: …`). IDs are stable; the header comment of the guard says what each one checks and why.
- A guard that needs the network checks `offline` and skips. A guard whose tool is missing skips locally and fails when `$CI` is set, if the check is mandatory.
- A freshly installed module passes its own guard, in a project that contains only that module and what it requires.
- A guard that proves a workflow step's behaviour by running its script marks the script with `# harness:<x>-begin` and `# harness:<x>-end`, and also pins how the step runs: no `if`, `continue-on-error`, `shell` or `defaults` on the step or its job, however the key is quoted, no `defaults` on the workflow, and a fixed step header. A kit test adds each of those keys to every marked step and expects the gate red.
- Numbers: `10` core, `15` session-settings, `18` parallel-sessions, `20` agents, `25` security-review, `30` ci-security, `31` ci-workflow, `35` node-audit, `40` auto-merge, `41` ready-on-green, `42` weekly-digest, `44` claude-ci, `45` claude-review, `46` openspec, `47` claude-rework, `48` headroom, `49` eco-design, `50` the project's own, `90`–`99` advisory (`90` the gaps left to fill, `91` the kit files that drifted from their recorded hash).

Tests a guard runs ship with the module, next to the code they test. Always name the test file (`node --test scripts/x.test.mjs`), never a directory: an older Node takes a directory argument for a module to run and fails. The gate and `_lib.sh` clear `NODE_TEST_CONTEXT`: a Node test run sets it for what it starts, and a `node --test` that inherits it exits 0 whatever its tests do (Node 20.12 and later), so a gate started from a project's own tests would otherwise pass a red self-test.

## Workflows

- `permissions: {}` at workflow level, the minimum per job.
- A short job that needs only bash, git, jq, the GitHub CLI and Node.js — no job `container:`, no Docker, done well within 15 minutes — runs on `__HARNESS_LIGHT_RUNNER__` (`README.md` § Actions minutes): every job is billed rounded up to the minute, and that runner costs less. A job that builds, scans or runs Claude stays on `ubuntu-latest`.
- Every `uses:` pinned to a full commit SHA with the version in a comment. A pin is copied from a reviewed source; never invented.
- `persist-credentials: false` on every checkout unless the job pushes.
- No `${{ … }}` inside `run:` — pass values through `env:`.
- A tool is installed from a pinned release verified by checksum, never `curl … | sh`.
- zizmor reports nothing on the rendered workflow, at any severity; an unfixable finding is silenced in `.github/zizmor.yml` with its justification.

## Credits

A piece drawn from a public source names it on its convention page, under `## Sources`: the repository or URL, its licence, the commit or date read, and what was taken (an idea, a pattern, text). The same line goes to the kit's `README.md` § Sources and credits. Copied text keeps the licence notice the source requires. This is the one place a name from outside the kit belongs; the rule below is about the project a piece was first written for, which stays unnamed.

## What a module must not contain

Names of people, organisations, products or infrastructure from the project a piece was first written for; issue or pull-request numbers; dates of incidents. State the reason behind a rule in general terms. A module is read by strangers.

## Checking a module

```bash
node --test test/*.test.mjs                                   # manifests, placeholders, slots, end-to-end installs
node bin/harness.mjs init /tmp/try --modules <id>   # then, in /tmp/try:
git init -q && git add -A && ./scripts/security-checks.sh --offline
```
