# Automated review of pull requests

**Rule (CLAUDE.md § Key conventions):** `claude-review.yml` reviews every code pull request against `CLAUDE.md`, read-only, from the default branch's tree; a verdict other than a pass fails the run and holds the pull request for a human. A change to the file updates the digest in `scripts/guards.d/45-claude-review.sh` and is merged by hand.

## Status

**Never run live by the kit's authors.** Written from the action's source and documentation, read at the pinned commit; the guard is tested, the workflow is not. Its first runs are its test: open a throwaway pull request that should pass, read the run log and the comment, then one that should hold (a deleted test, a rule of `CLAUDE.md` broken). Until both have behaved, keep a human merge on every pull request.

## Why

Three brakes keep an automated flow of changes from shipping whatever it produces: deterministic checks (the gate, the tests), an automated review, and a human review. The gate catches what has a fixed shape. A review catches what needs reading: a defect the tests do not cover, a rule of `CLAUDE.md` ignored, a check weakened in passing. Run locally, a review depends on someone remembering to run it; in CI it runs on every pull request, and a merge that waits for it cannot skip it.

It is a brake, not a boundary. The diff is written by whoever wrote the pull request, and a review that reads it can be steered by it. What stays a boundary is elsewhere: the gate, and the human merge of every change to what the harness executes.

## What a run reads

- **The default branch's tree, never the pull request's.** The job runs only for a pull request into the default branch (into another branch, the tree and the configuration would be that branch's, written by whoever pushed it); the checkout is the event's base commit. Every file Claude Code executes or obeys (`CLAUDE.md`, `.claude/`, `.mcp.json`) is therefore one that was already merged. The action also restores those paths from the base branch on pull-request events; this workflow does not rely on that.
- **The change as a diff**, fetched through the API for the event's two commits and written to `.review-input/pr.diff`. An empty diff, one over 400 kB, or one that changes a binary file (the diff only says that it differs) is a hold. A file the pull request adds is read from the diff, not as a file.
- **The standards**: `CLAUDE.md` (§ "Conventions for new code" and § "Key conventions" first) and the findings catalogue. An empty § "Conventions for new code" reviews against nothing of yours.
- **Not** the pull request's title, description or comments: the prompt names no text a person typed.

## What a run may do

- **Read, Grep and Glob only.** `--tools` makes them the only built-in tools available, `--allowedTools` approves them, and Bash, file edits, web access and sub-agents are denied by name as well: `--allowedTools` alone approves without restricting, so a tool the default branch's settings allow would otherwise stay usable. `--tools` was read in the help of Claude Code 2.1.322; the pinned action installs 2.1.302, where it was not checked — an unknown option fails the run, which is a hold. Settings deny reading `/proc`, `/sys`, `/etc`, the runner's temporary directory, Claude's own configuration and `.git/`. Whether a read outside the working directory is refused without those rules was not tested here: they are there so that the answer does not matter.
- **No GitHub tool.** With an explicit prompt and no GitHub tool allowed, the action configures no MCP server (read at the pinned commit).
- **The job token, `contents: read`.** It dies with the job. The checkout keeps it in git's configuration because the action fetches the base branch before setting up its own authentication.
- **The Claude token.** Assume a steered session could reach anything in its process's environment; what bounds the risk is that it has no tool that writes or sends anything. Its only output is the verdict.

## The verdict

The session returns JSON against a fixed schema: `pass` or `hold`, a two-sentence summary, findings marked `blocking` or `minor`. A second job, with no Claude in it and `pull-requests: write`, posts the verdict as a comment inside a fenced block (its backticks replaced, so the model's text renders as text and mentions nobody) and fails the run unless the verdict is `pass`. A review job that failed, timed out or returned nothing usable is a hold.

A held pull request waits for a human: read the comment, then fix and push (a new run follows) or merge by hand. Re-running the review does not help: the unattended merge requires every run of the review for the commit to be green at its first attempt, so a hold stays a hold until a new commit.

## What is not reviewed

- **Documentation-only pull requests**: the trigger skips the paths the CI workflow skips, and takes the Claude instruction files back. Keep the two lists identical.
- **Forks**: their runs get no secret. **Dependabot**: its runs get no secret either, and its pull requests have their own gate.
- **Pull requests a bot opens**: the action refuses to start for an actor that is not a user unless `allowed_bots` names it. As shipped, such a run fails, which holds the pull request. Name a bot there only after reading `docs/security.md` of the action at the pinned commit.
- **Pull requests into another branch**: the job is skipped (its `if:` compares the target with the default branch; the trigger has no `branches:` filter, so that the file is byte for byte the same in every project). A run that did nothing is not a pass: the unattended merge treats it as a hold.

## Merging unattended

A flow that merges on green must wait for this run as well as for CI. The kit's unattended merge does so by itself when `.github/workflows/claude-review.yml` exists on the default branch: it reacts to both workflows and merges only once the latest run of each is green for the same commit. Any other merge automation must do the same, or it merges before the review is in.

## Who already holds the secret

On a `pull_request` event from a branch of the repository, GitHub runs the workflow file **as the pull request writes it**, with the repository's secrets. Anyone who can push a branch can therefore already run a workflow that reads `CLAUDE_CODE_OAUTH_TOKEN`; this workflow adds no holder. It also means a pull request that edits `claude-review.yml` is reviewed by its own copy: such a pull request is never merged unattended (the merge gate holds `.github/workflows/claude*.yml`), and CR-1 goes red in its CI unless the same pull request updates the digest in the guard, which the merge gate holds too.

## Private repositories only

The comment and the run log are as visible as the repository. On a public repository, anyone can open a pull request; a fork gets no secret, but a collaborator's branch that carries an outsider's text does. Do not enable this workflow on a public repository as it stands.

## On every bump of `claude-code-action`

A bump is a hand merge (the file is gated). At the new commit, re-read what decides the properties above: the entry point and its inputs (`action.yml`), the mode chosen for a `pull_request` event with a prompt, which MCP servers that mode configures, how it obtains and configures the GitHub token and git, `--json-schema` and the `structured_output` output, the human-actor check, and the Claude Code version it installs. Then re-run the two throwaway pull requests.

## Sources

- [anthropics/claude-code-action](https://github.com/anthropics/claude-code-action), MIT licence, read at the pinned commit `f27be6b` (v1.0.252): `docs/security.md` for the pattern of checking out the base ref rather than the pull request's head, the list of configuration paths the action restores from the base branch, and the human-actor check; the source (`src/modes/detector.ts`, `src/modes/agent/index.ts`, `src/mcp/install-mcp-server.ts`, `src/entrypoints/run.ts`) for the mode chosen, the MCP servers configured and the `structured_output` output. The pins are copied from this kit's `claude.yml`.
- [mattpocock/skills](https://github.com/mattpocock/skills), MIT licence, read at commit `5863806` (2026-11-12): the three brakes of an automated flow (automated checks, automated review, human review) and the advice to open one trigger at a time, from `skills/in-progress/software-factory/SKILL.md`. Ideas only; no text was copied.

## Checks

`scripts/guards.d/45-claude-review.sh`:

- **CR-1** — `claude-review.yml` is byte for byte the reviewed file, pins aside. A deliberate change updates `CLAUDE_REVIEW_DIGEST` in the guard, in the same pull request; the guard prints the new value.
- **CR-2** — `claude-review.yml` is the only workflow that names a Claude secret or action — with `claude.yml` only when `scripts/guards.d/44-claude-ci.sh` pins it — no workflow reads all the secrets, and `claude-review.yml` has a top-level `permissions: {}`. File names are compared as they are, never expanded: a `claud[e].yml` is a third workflow.
- **CR-3** — the checks can fail: a table of broken copies must all go red (the pull request's tree checked out, any target branch, binary files let through, Bash allowed or made available, forks let in, a third Claude workflow, one whose name globs to `claude.yml`…), a pin bump must stay green.

They stop a regression, not a deliberate edit by someone who can change the guard too. That is what the human merge of workflow and guard changes is for. Three limits of theirs, accepted:

- CR-2 and CC-2 let the other Claude workflow in when its guard file exists; they do not check what the guard file contains. A stub would pass — and a stub is a change to `scripts/guards.d/`, which is never merged unattended.
- "Pins aside" accepts any 40-character SHA for the same action, including a commit that exists only in a fork of it. GA-1 checks the form of a pin, not where the commit lives, and zizmor's check for that needs the network. The human merge of `claude*.yml` and of Dependabot's Action bumps is the control.
- A run is known by its commit and its file, not by the pull request that started it: `auto-merge-policy.md` § Residual risks says what a run of the same file from another pull request can do.

## History

- Installed with the kit.
- After a fresh-context security review of the first version: the guards compared file names after shell expansion (a `claud[e].yml` passed as `claude.yml`); the findings catalogue the review reads could merge as documentation; a review re-run until pass, or a green run from another pull request on the same commit, could stand in for a hold; pull requests into another branch ran on that branch's configuration; a binary change went unread; `--allowedTools` was described as a restriction. Fixed or stated above.
