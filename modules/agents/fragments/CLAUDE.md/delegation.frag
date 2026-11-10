## Delegation

The main session is the **orchestrator**: it plans, arbitrates, reviews, owns security and docs, and commits. Bulk or mechanical work goes to the agents in `.claude/agents/`. A sub-agent starts empty: brief it like a peer (goal, task text verbatim, files to follow, verify command, bounds) and **verify its result rather than trusting it**.

| Work | Agent | Notes |
|---|---|---|
| Implement a well-specified task | `implementer` (Sonnet) | Runs the task's verify step, never commits; review its `git diff` before the next task. The sensitive areas under "Before pushing" stay on the main model — delegate there only tests or renames. |
| Tests / build / type-check / the gate, output condensed | `verifier` (Haiku, no CLAUDE.md) | Runs only the commands listed in `.claude/hooks/agent-bash-guard.config.json`. |
| Doc ↔ code sync check before a commit | `doc-sync` (Haiku, no CLAUDE.md) | Reports gaps against "Documentation maintenance"; drafting stays with the orchestrator. |
| Convention pre-review of a diff | `reviewer` (Sonnet, read-only) | Cheap first pass; verify each finding. Does not replace the "Before pushing" chain. |
<!-- harness:rows delegation-agents -->

Rules: a sub-agent never commits, pushes, or edits `CLAUDE.md`, `.claude/**`, `docs/**`, `.github/**`; do not spawn one for what three tool calls would do. The read-only agents are **enforced, not trusted**: a hook blocks any Bash command outside their allowlist (AG-1, AG-2) — but only in a folder whose workspace trust prompt was accepted, so a new worktree or clone, or a headless session, runs them unguarded until then. → `docs/conventions/agent-bash-guard.md`, `docs/conventions/delegation.md`
