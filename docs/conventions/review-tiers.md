# Review tiers before a push

**Rule (CLAUDE.md § Before pushing):** the gate runs before every push. The review that precedes it depends on what the diff touches: nothing more than a re-read for documentation and the wording of instructions (tier 1), the security passes for harness code that runs and for any change to what a session may do (tier 2), the whole chain for application code in a sensitive area (tier 3). Each pass runs once, on the complete diff.

## Why

One chain for every sensitive diff treats a reworded paragraph like a new authentication path. Review passes are the most expensive thing a session does: each one starts agents that re-read the diff from nothing, and a chain of them on a documentation change costs more than writing the change did. A cost that high gets the chain skipped where it matters, or run by rote where it does not.

The tiers follow what a change can do, not how large it is:

- **Tier 1** changes what is read. A wrong sentence in a convention page misleads; it does not execute. The control is the author's re-read and, where merges are unattended, the hand merge that instruction files require.
- **Tier 2** changes what runs with a session's or a runner's rights: a guard, a hook, a workflow, the tools an agent may call. A green test suite says little about these, so they get the security passes — but not `/code-review` or `/simplify`, which look for defects of application code.
- **Tier 3** is the code the product's safety rests on. It gets everything.

## Details

- **The gate is not a tier.** `./scripts/security-checks.sh` runs before every push, whatever changed, and again after every fix.
- **The highest tier wins.** A diff that touches a workflow and a sensitive controller is tier 3.
- **Wording or privilege?** An instruction file is prose until the change alters what a session may do: an agent's `tools`, `hooks`, `permissionMode`, `mcpServers` or `skills`; a skill's `allowed-tools`; a hook command in `.claude/settings.json`; a server in `.mcp.json`; a rule of "Before pushing" or of a merge gate that is removed or weakened. Any of these is tier 2. In doubt, tier 2.
- **Once, on the complete diff.** Run the chain when the change is finished, not after each commit. A fix made for a finding is checked by the gate and by reading it; a new chain is for a new change. If the fix itself moves the diff into a higher tier, that tier's passes run.
- **An ephemeral session (a cloud container).** "Before pushing" still holds where a push can end in an unattended merge: never push such a branch before the chain ends. Where the pull request will be held by the merge gate (a held path, a ruleset's review), pushing a draft early is acceptable so the work is not lost, provided the description starts with "chain incomplete, do not merge" and says which passes remain. A hook that asks to push does not change this rule: it asks, the rule decides.
- **Leave a record in the pull request.** The description carries a `## Review record` section: the tier, the passes that ran and on which commit, the findings fixed or answered, and the passes not run with the reason. It is written when the chain ends and names the head it covers; a head that moved since is a record to renew, or to say so. A reader and a check (RR-1, below) can tell a statement was made; neither proves the passes were good.
- **`/simplify` is conditional.** It exists to catch what the fixes of the earlier passes brought in: duplication, an abstraction added in a hurry. When those passes led to no new code, there is nothing for it to look at.
- **Modules add passes** above the built-in ones, each naming the tiers it applies to (the `before-pushing` slot).
- **The sensitive areas** are the project's to list, under the table in `CLAUDE.md`. Until they are listed, treat application code that handles authentication, authorization, user data or external input as tier 3.

## Checks

Which tier a diff falls in is a judgement. What is mechanical is the gate, and it runs in every tier, and one guard that reads the record.

- **RR-1** (advisory) — the pull request description has a `## Review record` section, and the section names the head the pull request has now: a hexadecimal token of seven characters or more that is a prefix of that commit (`scripts/guards.d/12-review-record.sh`). A missing section, or one that names an earlier head, is a note in the gate's output and, on a runner, a warning annotation. It stays advisory until a project has seen it right for a while: `REVIEW_RECORD=enforce` in the gate step's `env:` turns it into a failure.
  - **Inputs.** `PR_BODY_FILE` (a file holding the description) or `PR_BODY`, and `PR_HEAD_SHA`. With neither `PR_BODY_FILE` nor `PR_HEAD_SHA` set — a run on a laptop, a push, a schedule — the guard skips. Without `PR_HEAD_SHA` it compares with `git rev-parse HEAD`; on a pull request CI checks out a merge commit, so set it.
  - **The description is untrusted.** It reaches the guard through `env:` or a file, never inside a `run:` script, and the guard prints none of it.
  - **Wiring.** With `ci-security`, `security.yml` sets `PR_BODY` and `PR_HEAD_SHA` on its gate step from the pull request's event, and a CI workflow that listens to `edited` (the `ci-workflow` skeleton does) reruns it when the description changes. A re-run of an old run reads the description as it was then. A project with its own gate step does the same: two lines of `env:`.
  - **Environment.** `PR_BODY` is inherited by every guard the gate runs: a guard must not print its environment or run under `set -x`, or the description would be printed with workflow commands live. The runner's limit on one environment string (128 KB) is also a limit on the description; a longer one fails the step, on that author's own pull request.
  - **Not checked.** That the passes ran, or that the tier is the right one. A record can also name the head and be false.

## History

- Installed with the kit.
- RR-1 added, advisory: the guard reads the `## Review record` section of the pull request description. Tested in the kit's suite (missing section, stale head, CRLF, an empty section, enforce mode, skipped when unset); not yet run on a live pull request.
