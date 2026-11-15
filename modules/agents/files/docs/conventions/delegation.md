# Delegation: an orchestrator and specialist agents

**Rule (CLAUDE.md § Delegation):** the main session plans, arbitrates, reviews, owns security and docs, and commits. Bulk or mechanical work goes to the agents in `.claude/agents/`. A sub-agent is briefed like a peer and its result is verified, never trusted.

## Why

One session doing everything pays for it twice: the context fills with test output and file dumps, and the strongest model spends its attention on work a lighter one does as well. Splitting the work keeps the orchestrator's context for decisions and puts volume on cheaper models.

The split has a cost of its own. A sub-agent knows only what its brief says, and the orchestrator sees only the summary that comes back: both hand-offs drop detail, and a mistake returns in the same confident tone as a result. Hence the two halves of the rule — a complete brief going in, a check of the actual diff or output coming out.

## The agents

| Agent | Model | Loads CLAUDE.md | Writes | Role |
|---|---|---|---|---|
| `implementer` | Sonnet | yes | yes | One well-specified task and its verify step. Never commits. |
| `verifier` | Haiku | no | no | Runs the configured verification commands, returns pass/fail with the first error of each failure. |
| `doc-sync` | Haiku | no | no | Compares a diff with the doc-sync mapping of `CLAUDE.md`, reports the gaps. |
| `reviewer` | Sonnet | yes | no | Convention pre-review of a diff. |

The two Haiku agents skip `CLAUDE.md` (`omitClaudeMd: true`): what they need is in their own file, and the instruction file would be dead weight on every call. The three agents that do not write are confined by a hook, not by wording — see `agent-bash-guard.md`.

## Briefing

A brief is the only context the agent will have. It contains:

- the goal, and the task text verbatim rather than paraphrased;
- the files to imitate (the nearest existing module or test);
- the verify command, and what "done" looks like;
- the bounds: which files it may touch, what it must not do.

If you cannot write that brief, the task is not understood well enough to hand off.

## What stays on the main model

The areas `CLAUDE.md` lists under "Before pushing" — authentication and authorization, the code that guards writes, cryptography, CI and the instruction files. There, delegate only tests or mechanical renames. A slip in those areas is cheap to make and expensive to find, and the review chain assumes the author understood the change.

## Verifying

- After `implementer`: read its `git diff` before starting the next task. A fix without the regression test that failed before it is a finding.
- After `reviewer` or any review agent: confirm each finding at the line it names. A finding you cannot reproduce is discarded with a reason, not silently.
- After `verifier`: its report is a condensation. For a failure that matters, read the first error it quotes in the real output.
- An agent's "blocked" or "done" is a claim. The diff, the test run or the file on disk is the proof.

## Rules

- A sub-agent never commits, pushes, or edits `CLAUDE.md`, `.claude/**`, `docs/**`, `.github/**`. The orchestrator does, after reviewing.
- Do not spawn an agent for what three tool calls would do. What a session may spend on agents beyond this table — models, an estimate before a large run, the stop rule — is `session-cost.md`.
- A new agent gets a row in the "Delegation" table of `CLAUDE.md`, and the hook if it has Bash and no editing tool (AG-1 enforces that).
- After adding or changing an agent file, restart the open sessions.

## History

- Installed with the kit.
