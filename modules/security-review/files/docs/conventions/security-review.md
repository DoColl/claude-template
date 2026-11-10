# Security review: a fresh-context agent, a project skill, pinned plugins

**Rule (CLAUDE.md § Before pushing):** a diff that touches a sensitive area gets a fresh-context `security-reviewer` pass, then `/project-security-review`, before the generic review chain and the gate. Claude Code plugins are used only at a reviewed commit, recorded in `scripts/reviewed-plugins.json`.

## Why

**A second reading that is not anchored on the first.** The session that wrote a change reviews it with the author's assumptions still in context: what it believed the code does, which paths it considered. A sub-agent that starts empty reads the diff as it is. That independence is the whole value of `security-reviewer`; it is why the agent is given the diff and the catalogue, never the author's explanation of why the change is safe.

**The project's own memory.** A generic review does not know that this codebase once shipped a write without an ownership check, or that a particular export must go through a sanitizer. `SECURITY_REVIEW*.md` records what went wrong; the gate replays it mechanically; the skill's Step 2 holds the invariants a reviewer checks by reading.

**Plugins are code that every session runs.** A plugin's skills, hooks and commands execute with the session's tools and, depending on how they are declared, without a prompt. Reading a plugin once and then installing "the latest" is not a review.

## The pieces

- **`security-reviewer`** (`.claude/agents/`) — Opus, read-only, confined by the Bash allowlist (`agent-bash-guard.md`), desk-only: it never calls a running service and never executes the code under review. A finding needs a lower-trust actor, an accepted input, a crossed boundary and an observable result; `CONFIRMED` findings carry a severity, `NEEDS_VALIDATION` ones name the missing fact. The orchestrator verifies every finding at the line it names.
- **`/project-security-review`** (`.claude/skills/project-security-review/SKILL.md`) — yours to fill: the trigger list, the invariants, the scanner routing. The agent preloads it.
- **The chain** — `security-reviewer` → `/project-security-review` → `/security-review` → `/code-review` → `/simplify` → `./scripts/security-checks.sh`. The agent's findings feed the chain; they never replace it. Skip the agent only for a docs-only diff: size is no proxy for risk.
- **The findings policy** — CLAUDE.md § Findings policy. Every finding is fixed before merge or carries a written derogation.

## Plugins

- A marketplace is registered deliberately and a plugin is **never auto-installed**: the trust prompt is the control.
- Before use, read the plugin's directory in full at a fixed commit. Look at what its skills and commands are allowed to do without asking (`allowed-tools`), at its hooks (some run on every turn), and at anything that fetches or executes.
- Record it in `scripts/reviewed-plugins.json`: `reviewed` is the commit you read, `installed` the commit the install actually copied. They can differ — at the time of writing an install takes the marketplace's current head, not the commit you looked at — so the check runs **after** install: either the two are equal, or a compare between them shows no file changed under the plugin's directory.
- A plugin you decided against is recorded as `rejected` with the reason, so nobody re-evaluates it from scratch and the gate catches it being installed anyway.
- An update is a new review: re-read at the new commit, then update the record.

## Checks

- **PL-1** (`scripts/guards.d/25-plugin-pins.sh`, local only) — every `retained` plugin is installed at its recorded commit; no `rejected` plugin is installed. It reads a file Claude Code maintains and does not document (`~/.claude/plugins/installed_plugins.json`): a record without a commit counts as a mismatch, never as a pass. With an empty registry there is nothing to compare, and the machine's other plugins are not listed.
- **AG-1** covers the agent's hook line like every other read-only agent.

## History

- Installed with the kit.
