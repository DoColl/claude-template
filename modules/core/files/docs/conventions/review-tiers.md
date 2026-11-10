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
- **`/simplify` is conditional.** It exists to catch what the fixes of the earlier passes brought in: duplication, an abstraction added in a hurry. When those passes led to no new code, there is nothing for it to look at.
- **Modules add passes** above the built-in ones, each naming the tiers it applies to (the `before-pushing` slot).
- **The sensitive areas** are the project's to list, under the table in `CLAUDE.md`. Until they are listed, treat application code that handles authentication, authorization, user data or external input as tier 3.

## Checks

None: which tier a diff falls in is a judgement. What is mechanical is the gate, and it runs in every tier.

## History

- Installed with the kit.
