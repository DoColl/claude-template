# Automated review of pull requests

**Rule (CLAUDE.md § Key conventions):** `claude-review.yml` reviews every code pull request into the default branch once its CI is green, against `CLAUDE.md`, read-only, from the default branch's tree; a verdict other than a pass fails the run and holds the pull request for a human. A change to the file updates the digest in `scripts/guards.d/45-claude-review.sh` and is merged by hand.

## Status

**Run live once, on 2026-11-12, in a throwaway private repository (the kit at commit `e677e3d` plus the `actions: read` fix of `claude-rework`; `claude-code-action` at `f27be6b`, which installed Claude Code 2.1.302).** Observed: the end of a CI run started the review, named `Claude review of <sha>`; `--tools` was accepted; pull requests that followed `CLAUDE.md` passed (with sensible minor findings) and ones that broke its "Conventions for new code" held, every blocking finding correct; the unattended merge waited for the review and merged on its pass. A CI run with nothing to review gives a run named `Claude review, nothing to review` that ends `skipped`. A re-run of a held review held again, and nothing merged. Not exercised: a re-run that passes (the first-attempt rule is tested on tables only), a binary or oversized diff, a pull request a bot pushed to. Before relying on it in your repository, watch one pull request pass and one hold.

## Why

Three brakes keep an automated flow of changes from shipping whatever it produces: deterministic checks (the gate, the tests), an automated review, and a human review. The gate catches what has a fixed shape. A review catches what needs reading: a defect the tests do not cover, a rule of `CLAUDE.md` ignored, a check weakened in passing. Run locally, a review depends on someone remembering to run it; in CI it runs on every pull request, and a merge that waits for it cannot skip it.

It is a brake, not a boundary. The diff is written by whoever wrote the pull request, and a review that reads it can be steered by it. What stays a boundary is elsewhere: the gate, and the human merge of every change to what the harness executes.

## How a run starts

**By the end of the CI workflow, never by the pull request** (`workflow_run`). That trigger always runs the workflow file as the default branch holds it: a pull request cannot run its own copy of the review, so a green review run cannot be forged by a branch that carries an edited one. The job goes on only for a green CI run that a pull request started from a branch of this repository, Dependabot's excepted.

It then looks for the pull request: the one open pull request into the default branch whose head is the commit CI validated. None, or more than one, is a hold. A pull request into another branch is therefore never reviewed.

**The run name carries the commit**: `Claude review of <sha>`, or `Claude review, nothing to review` when the job does not go on. Only this file, on the default branch, sets it, which is why the unattended merge can find the review of a commit by its name.

## What a run reads

- **The default branch's tree, never the pull request's.** `workflow_run` checks out the default branch. Every file Claude Code executes or obeys (`CLAUDE.md`, `.claude/`, `.mcp.json`) is therefore one that was already merged.
- **The change as a diff**, fetched through the API between the pull request's base commit and the commit CI validated, and written to `.review-input/pr.diff`. An empty diff, one over 400 kB, or one that changes a binary file (the diff only says that it differs) is a hold. A file the pull request adds is read from the diff, not as a file.
- **The standards**: `CLAUDE.md` (§ "Conventions for new code" and § "Key conventions" first) and the findings catalogue at the root (`SECURITY_REVIEW*.md`), which the unattended merge never lands by itself. Other pages, those `CLAUDE.md` points to included, are context: the prompt says none of them can make acceptable what the standards forbid. The convention pages under `docs/conventions/` are never merged unattended (the merge gate holds them); any other page `CLAUDE.md` points to can merge as documentation unless the project adds it to `PROJECT_GATE_RE`. An empty § "Conventions for new code" reviews against nothing of yours.
- **Not** the pull request's title, description or comments: the prompt names no text a person typed.

## What a run may do

- **Read, Grep and Glob only.** `--tools` makes them the only built-in tools available, `--allowedTools` approves them, and Bash, file edits, web access and sub-agents are denied by name as well: `--allowedTools` alone approves without restricting, so a tool the default branch's settings allow would otherwise stay usable. `--tools` was read in the help of Claude Code 2.1.322 and accepted, in the live runs, by 2.1.302, which the pinned action installs; an unknown option would fail the run, which is a hold. Settings deny reading `/proc`, `/sys`, `/etc`, the runner's temporary directory, Claude's own configuration and `.git/`. Whether a read outside the working directory is refused without those rules was not tested here: they are there so that the answer does not matter.
- **No GitHub tool.** With an explicit prompt and no GitHub tool allowed, the action configures no MCP server (read at the pinned commit).
- **The job token, `contents: read` and `pull-requests: read`.** It dies with the job. The checkout does not keep it; the action sets up its own git authentication with it, under `.git/`, which the session may not read.
- **The Claude token.** Assume a steered session could reach anything in its process's environment; what bounds the risk is that it has no tool that writes or sends anything. Its only output is the verdict.

## The verdict

The session returns JSON against a fixed schema: `pass` or `hold`, a two-sentence summary, findings marked `blocking` or `minor`. A second job, with no Claude in it and `pull-requests: write`, posts the verdict as a comment inside a fenced block (its backticks replaced, so the model's text renders as text and mentions nobody) and fails the run unless the verdict is `pass`. A review job that failed, timed out or returned nothing usable is a hold.

The comment starts with `Automated review of <full commit SHA>`. The verdict is also kept for one day as an artifact of the run, `claude-review-verdict` (`verdict.json`: the pull request, the commit, the verdict and the review): a comment can be posted by any workflow of the repository, an artifact of this run only by this file as the default branch holds it, so something that acts on a hold reads the artifact.

A held pull request waits for a human: read the comment, then fix and push (a new run follows) or merge by hand. Re-running the review does not help: the unattended merge requires every review run that names the commit to be green at its first attempt, so a hold stays a hold for that commit — while it is among the review's latest 100 runs, which is where the merge looks.

**For that commit only, and not for ever.** A new commit gets a new review, even one with the same tree: amending and force-pushing after a hold rolls the dice again. Every end of a CI run starts a review run, most of them with nothing to review, so a hundred re-runs of any cheap CI run push a held run out of that window, and a CI re-run of the held commit then starts a fresh review. Someone allowed to delete workflow runs could also remove a held run. A hold is a brake on a session that goes wrong, not a lock against someone who can push.

## What is not reviewed

- **Documentation-only pull requests**: CI does not run on them, so neither does the review.
- **Forks** and **Dependabot**: the job does not go on; Dependabot's pull requests have their own merge gate.
- **Pull requests whose CI is red**: nothing to review until it is green.
- **Pull requests a bot pushes to**: the action refuses to start unless the actor of the run — for this trigger, whoever pushed the commit CI ran on, and the actor of that CI run — is a user with write access, or a bot `allowed_bots` names. Who opened the pull request is not what is checked. As shipped, such a run fails, which holds the pull request. Name a bot there only after reading `docs/security.md` of the action at the pinned commit.
- **Pull requests into another branch**: none is found, and the run fails.

## Merging unattended

A flow that merges on green must wait for this run as well as for CI. The kit's unattended merge does so by itself when `.github/workflows/claude-review.yml` exists on the default branch: the review's end starts it, it accepts a review run only when `workflow_run` started it from this file, reads the commit from the run name, and merges only once every CI run and every review run for that commit are green. Any other merge automation must do the same, or it merges before the review is in.

The chain is CI, then the review, then the merge: two `workflow_run` links. GitHub documents that it follows at most three levels of workflows chained by `workflow_run` beyond the first, so one more link after the merge would still fire, and no more.

## Who already holds the secret

On a `pull_request` event from a branch of the repository, GitHub runs the workflow file **as the pull request writes it**, with the repository's secrets. Anyone who can push a branch can therefore already run a workflow that reads `CLAUDE_CODE_OAUTH_TOKEN`; this workflow adds no holder. What it changes is the other way round: a pull request that edits `claude-review.yml` does not get its own copy run as the review, since the review only ever runs from the default branch. Such a pull request is never merged unattended (the merge gate holds `.github/workflows/claude*.yml`), and CR-1 goes red in its CI unless the same pull request updates the digest in the guard, which the merge gate holds too.

## Private repositories only

The comment and the run log are as visible as the repository. On a public repository, anyone can open a pull request; a fork gets no secret, but a collaborator's branch that carries an outsider's text does. Do not enable this workflow on a public repository as it stands.

## On every bump of `claude-code-action`

A bump is a hand merge (the file is gated). At the new commit, re-read what decides the properties above: the entry point and its inputs (`action.yml`), the mode chosen for a `workflow_run` event with a prompt, which MCP servers that mode configures, how it obtains and configures the GitHub token and git, `--json-schema` and the `structured_output` output, the human-actor check, and the Claude Code version it installs. Then re-run the two throwaway pull requests.

## Sources

- [anthropics/claude-code-action](https://github.com/anthropics/claude-code-action), MIT licence, read at the pinned commit `f27be6b` (v1.0.252): `docs/security.md` for the trust model of `workflow_run` and the human-actor check; the source (`src/modes/detector.ts`, `src/modes/agent/index.ts`, `src/mcp/install-mcp-server.ts`, `src/entrypoints/run.ts`) for the mode chosen, the MCP servers configured and the `structured_output` output. The pins are copied from this kit's `claude.yml`.
- [mattpocock/skills](https://github.com/mattpocock/skills), MIT licence, read at commit `5863806` (2026-11-12): the three brakes of an automated flow (automated checks, automated review, human review) and the advice to open one trigger at a time, from `skills/in-progress/software-factory/SKILL.md`. Ideas only; no text was copied.

## Checks

`scripts/guards.d/45-claude-review.sh`:

- **CR-1** — `claude-review.yml` is byte for byte the reviewed file, pins and the CI workflow's name aside. A deliberate change updates `CLAUDE_REVIEW_DIGEST` in the guard, in the same pull request; the guard prints the new value.
- **CR-2** — `claude-review.yml` is the only workflow that names a Claude secret or action — with `claude.yml` only when `scripts/guards.d/44-claude-ci.sh` pins it — no workflow reads all the secrets, and `claude-review.yml` has a top-level `permissions: {}`. File names are compared as they are, never expanded: a `claud[e].yml` is a third workflow.
- **CR-3** — the checks can fail: a table of broken copies must all go red (started by the pull request, a commit named on every run, credentials kept, binary files let through, Bash allowed or made available, forks let in, a third Claude workflow, one whose name globs to `claude.yml`…), a pin bump and another CI workflow name must stay green. Any edit to the file trips the digest, so the table proves the digest catches each change, not that each property has its own check.

They stop a regression, not a deliberate edit by someone who can change the guard too. That is what the human merge of workflow and guard changes is for. Three limits of theirs, accepted:

- CR-2 and CC-2 let the other Claude workflow in when its guard file exists; they do not check what the guard file contains. A stub would pass — and a stub is a change to `scripts/guards.d/`, which is never merged unattended.
- "Pins aside" accepts any 40-character SHA for the same action, including a commit that exists only in a fork of it. GA-1 checks the form of a pin, not where the commit lives, and zizmor's check for that needs the network. The human merge of `claude*.yml` and of Dependabot's Action bumps is the control.
- A CI run is known by its commit and its workflow name, not by the pull request that started it: `auto-merge-policy.md` § Residual risks says what a run from another pull request can and cannot do.

## History

- Installed with the kit.
- After a fresh-context security review of the first version: the guards compared file names after shell expansion (a `claud[e].yml` passed as `claude.yml`); the findings catalogue the review reads could merge as documentation; a review re-run until pass, or a green run from another pull request on the same commit, could stand in for a hold; pull requests into another branch ran on that branch's configuration; a binary change went unread; `--allowedTools` was described as a restriction. Fixed or stated above.
- The review moved to `workflow_run`, after a second review: on `pull_request`, a pull request into another branch could run its own copy of the file and produce a green review run for a commit. The merge now trusts only review runs that `workflow_run` started, finds them by the commit their run name carries, and requires every CI run of the commit to be green, not only the latest. Not run live.
- The comment names the full commit SHA, and the verdict is kept as the run's artifact `claude-review-verdict` for one day, for whatever acts on a hold.
- First live run (§ Status): the chain CI → review → merge fired as described; nothing in this workflow changed.
