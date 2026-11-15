# What a session spends on sub-agents

**Rule (CLAUDE.md § Key conventions):** bulk agent work — research, lookups, verification, mechanical changes — runs on a lighter model, chosen on each agent call. Before a run of more than five agents, the session states its size and waits for the user's go-ahead. One pass by default; a fix-and-verify loop that has not converged after one round stops and reports. This rule holds for the whole session, whatever repository it is in.

## Why

Sub-agents are the most expensive thing a session can start, and nothing else in the harness looks at them: the gate and the review passes judge the code, not what writing it cost. Left to defaults, every agent runs on the session's own model, which is usually the most expensive one.

The way it goes wrong is ordinary. A long research-and-review session can start well over a hundred agents, all on the session's model. Research runs overlap and check the same facts again. A second agent re-verifies every fact, decisive or not. Gap-filling rounds follow, and a correction loop on low-severity findings runs round after round without converging. Nobody gave the user a figure before it started. A project rule asking for lighter models can exist and still be ignored: the session reads it as local to that repository, or a general instruction that "cost is not a constraint" overrides it.

## Details

- **Light by default.** Research, lookups, file sweeps, verification, test runs and mechanical edits go to the lightest model that does them well, named on the agent call itself. The session's model is kept for synthesis, the security-sensitive areas of `CLAUDE.md` § Before pushing, and the final review. Do not change the sub-agent model through a global setting: the choice belongs to each call, where its reason is visible.
- **An estimate first.** Before more than five agents, or any orchestrated multi-agent run, give the user the number of agents, an order of magnitude of tokens and the expected duration, and wait for a yes. A token budget the user gives is a hard cap; stop at it and report what is left.
- **One pass.** One research pass. Cross-check only the facts a recommendation rests on. No gap-filling round unless the user asks for one. When the scope changes, extend the run in progress instead of starting one that overlaps it.
- **A stop rule.** A loop of fixes and re-verification that has not converged after one round stops. Report what is left, with its severity, and let the user decide whether another round is worth it.
- **Precedence.** A project's delegation or cost rule applies to everything the session does, including work on files of another repository. An instruction that does not name the rule does not lift it; the user lifts it by saying so.
- **What the project fills in**: which model counts as light and which is kept for the work above, as a `TODO(harness)` comment in `CLAUDE.md` turned into a line. The kit names no model: they change faster than this page.
- **Agents defined in `.claude/agents/`** carry their model in their own file; this rule covers every other agent a session starts, and the decision to start one at all.

## Checks

None: a guard sees files, not what a session spent. The `/retro` skill counts a run that broke this rule among the incidents of the session (step 2, "cost more than it should").

## History

- Installed with the kit.
