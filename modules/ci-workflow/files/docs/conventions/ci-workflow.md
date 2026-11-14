# The CI workflow skeleton

**Rule:** `.github/workflows/ci.yml` calls `security.yml` as its first job and every other job waits for it. Its `pull_request` trigger skips documentation but takes the Claude instruction files back, so the gate runs on a pull request that touches only them.

## Status

The call to `security.yml` and the triggers are the ones `security-workflow.md` § Wiring describes. Run live once, on 2026-11-12, in a throwaway private repository (the kit at commit `e677e3d` plus the `actions: read` fix of `claude-rework`; `claude-code-action` at `f27be6b`, which installed Claude Code 2.1.302), with one test job added after the call. Observed: a documentation-only pull request started no run; one that only touched `CLAUDE.md` did, through the re-inclusion; one opened into another branch started none, and its `edited` event started one once it was retargeted onto the default branch. In your repository, open one pull request that only touches `CLAUDE.md` and check that the run starts.

## Why

A project that installs the security workflow still has to write the workflow that calls it, and until it does the enforcing tier does not run on pull requests at all. The call is the same in every project; only the jobs after it depend on the stack. So the call is shipped, and the jobs are left as a marked gap.

The path filter has a trap. A CI workflow usually skips documentation, and `CLAUDE.md` and the agent definitions under `.claude/` are Markdown. The gate has checks that exist for those files — the byte budget of `CLAUDE.md` (CM-1), its pointers (CM-2), the hook line of every read-only agent where the agents are installed — and with a plain `paths-ignore: ['**.md']` none of them runs on the one kind of pull request that changes them.

## Details

- **`push`** to the default branch uses `paths-ignore`. A documentation-only push is not lost: the `push` trigger of `security.yml` has the same list as `paths`, and runs the enforcing tier on it.
- **`pull_request`** uses `paths`, because `paths-ignore` cannot re-include. The list starts with `'**'`, removes the documentation set with `!` patterns, then adds `.claude/**` and `CLAUDE.md` again, at the root and at any depth. A later pattern overrides an earlier one, so the order is the rule.
- **The documentation set** (`docs/**`, `**.md`, `LICENSE`, `.gitignore`) is the same in `ci.yml` (twice), in the `push.paths` of `security.yml`, and — when the auto-merge module is installed — in its `pull_request.paths` and its `NON_DOCS` pattern (the gate's, and its two copies in the checks of what the merge wrote, which its guard holds equal). Change it everywhere or nowhere.
- **Re-include only what is held for a hand merge.** Where merges are unattended, a pull request whose every file is documentation is merged at once, without waiting for CI. A path re-included here that is not also held by the merge gate would be merged while the run this file starts is still in flight.
- **The name** on the first line is the one given at installation (`CI` by default). Anything that waits for this workflow waits for that exact name.
- **A project without code** keeps the file as installed: one job, the gate. The `TODO(harness)` block stays until there is something to build or test.
- **This file is a seed**: the kit never overwrites it. A project that already has a CI workflow does not need this module; it adds the call to its own.

### Retargeted pull requests

The `pull_request` trigger lists `edited` on top of GitHub's default types (`opened`, `synchronize`, `reopened`). A pull request retargeted to the default branch is an `edited` event: without it, no run of this workflow would test it against the default branch, and the only run of its commit could be one that a pull request into another branch started, from that branch's copy of this file. The `auto-merge` module fails its gate (AM-9) on a CI workflow without it. The price: a title or description edit re-runs CI.

## Checks

- **GA-1, GA-2** apply to this workflow like any other.
- This module ships no check of the path filter. The kit's own tests check that the documentation set is the same in every workflow it ships and that each re-included path is one the merge gate holds.

## History

- Installed with the kit.
- `edited` added to the `pull_request` types, so that a retargeted pull request gets its own run.
- First live run (§ Status): the path filter and the `edited` type behaved as described.
