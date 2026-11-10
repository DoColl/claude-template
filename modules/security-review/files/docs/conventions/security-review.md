# Security review: a fresh-context agent, a project skill, pinned plugins

**Rule (CLAUDE.md § Before pushing):** a diff of tier 2 or 3 gets a fresh-context `security-reviewer` pass before the built-in ones; a tier 3 diff also gets `/project-security-review`. Kit files still identical to their recorded hash are out of scope. Claude Code plugins are used only at a reviewed commit, recorded in `scripts/reviewed-plugins.json`.

## Why

**A second reading that is not anchored on the first.** The session that wrote a change reviews it with the author's assumptions still in context: what it believed the code does, which paths it considered. A sub-agent that starts empty reads the diff as it is. That independence is the whole value of `security-reviewer`; it is why the agent is given the diff and the catalogue, never the author's explanation of why the change is safe.

**The project's own memory.** A generic review does not know that this codebase once shipped a write without an ownership check, or that a particular export must go through a sanitizer. `SECURITY_REVIEW*.md` records what went wrong; the gate replays it mechanically; the skill's Step 2 holds the invariants a reviewer checks by reading.

**Plugins are code that every session runs.** A plugin's skills, hooks and commands execute with the session's tools and, depending on how they are declared, without a prompt. Reading a plugin once and then installing "the latest" is not a review.

## The pieces

- **`security-reviewer`** (`.claude/agents/`) — Opus, read-only, confined by the Bash allowlist (`agent-bash-guard.md`), desk-only: it never calls a running service and never executes the code under review. A finding needs a lower-trust actor, an accepted input, a crossed boundary and an observable result; `CONFIRMED` findings carry a severity, `NEEDS_VALIDATION` ones name the missing fact. The orchestrator verifies every finding at the line it names.
- **`/project-security-review`** (`.claude/skills/project-security-review/SKILL.md`) — yours to fill: the trigger list, the invariants, the scanner routing. The agent preloads it.
- **The chain** — by tier (`docs/conventions/review-tiers.md`). Tier 1, documentation and the wording of instructions: no pass. Tier 2, harness code that runs or a change to what a session may do: `security-reviewer` → `/security-review`. Tier 3, application code in a sensitive area: `security-reviewer` → `/project-security-review` → `/security-review` → `/code-review` → `/simplify` when the fixes added code. The gate runs in every tier. The agent's findings feed the passes after it; they never replace them. Each pass runs once, on the complete diff.
- **The findings policy** — CLAUDE.md § Findings policy. Every finding is fixed before merge or carries a derogation written in the Derogations table of `SECURITY_REVIEW.md`.

## Scope: what was already reviewed in the kit

The harness files are privileged code, and their review belongs where they are written: in the kit, whose README says what that review covered and what it did not. Reading them again in every project that installs them costs the most and finds the least: an installation is dozens of files, nearly all of them byte-for-byte what the kit shipped.

- **Out of scope**: a kit-owned file still identical to the hash `.claude/harness.json` recorded for it. The gate's advisory guard HD-1 lists the ones that are not (`docs/conventions/local-gate.md` § Kit files and their hashes).
- **In scope**: the seeds (`"seed": true` in the manifest — `CLAUDE.md`, the review skill, the configs — once the project has filled them), every file of the project's own, and each kit file HD-1 lists.
- **A pull request that installs or updates the kit** writes the manifest, so its hashes are part of the change and prove nothing alone. The reference is then the kit: from the checkout the files came from, `node <kit>/bin/harness.mjs update . --dry-run` must print `nothing to write` with no `left alone`, `would be updated` or `CONFLICTS` list. Whoever opens the pull request runs it, names the kit commit in the description and gives both to the reviewer. The review then covers the seeds as filled, the `modules` and `values` of the manifest, and the project's own files — not the kit's.
- The scope applies to every pass of the chain, not only to the agent.

What this does not cover: the kit itself. A project that wants more than the kit's own review reads the kit at the commit it installs, once, as it would a plugin — in the kit's checkout, not file by file in the project's pull request.

## Plugins

- A marketplace is registered deliberately and a plugin is **never auto-installed**: the trust prompt is the control.
- Before use, read the plugin's directory in full at a fixed commit. Look at what its skills and commands are allowed to do without asking (`allowed-tools`), at its hooks (some run on every turn), and at anything that fetches or executes.
- Record it in `scripts/reviewed-plugins.json`: `reviewed` is the commit you read, `installed` the commit the install actually copied. They can differ — at the time of writing an install takes the marketplace's current head, not the commit you looked at — so the check runs **after** install: either the two are equal, or a compare between them shows no file changed under the plugin's directory.
- A plugin you decided against is recorded as `rejected` with the reason, so nobody re-evaluates it from scratch and the gate catches it being installed anyway.
- An update is a new review: re-read at the new commit, then update the record.

## Checks

- **PL-1** (`scripts/guards.d/25-plugin-pins.sh`, local only) — every `retained` plugin is installed at its recorded commit; no `rejected` plugin is installed. It reads a file Claude Code maintains and does not document (`~/.claude/plugins/installed_plugins.json`): a record without a commit counts as a mismatch, never as a pass, and a plugin installed in several scopes has one record per scope, each of which is compared. With an empty registry there is nothing to compare, and the machine's other plugins are not listed.
- **AG-1** covers the agent's hook line like every other read-only agent.

## History

- Installed with the kit.
