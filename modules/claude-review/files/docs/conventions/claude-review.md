# Automated review of pull requests

**Rule (CLAUDE.md § Key conventions):** `claude-review.yml` reviews every code pull request against `CLAUDE.md`, read-only, from the default branch's tree; a verdict other than a pass fails the run and holds the pull request for a human. A change to the file updates the digest in `scripts/guards.d/45-claude-review.sh` and is merged by hand.

## Status

**Never run live by the kit's authors.** Written from the action's source and documentation, read at the pinned commit; the guard is tested, the workflow is not. Its first runs are its test: open a throwaway pull request that should pass, read the run log and the comment, then one that should hold (a deleted test, a rule of `CLAUDE.md` broken). Until both have behaved, keep a human merge on every pull request.

## Why

Three brakes keep an automated flow of changes from shipping whatever it produces: deterministic checks (the gate, the tests), an automated review, and a human review. The gate catches what has a fixed shape. A review catches what needs reading: a defect the tests do not cover, a rule of `CLAUDE.md` ignored, a check weakened in passing. Run locally, a review depends on someone remembering to run it; in CI it runs on every pull request, and a merge that waits for it cannot skip it.

It is a brake, not a boundary. The diff is written by whoever wrote the pull request, and a review that reads it can be steered by it. What stays a boundary is elsewhere: the gate, and the human merge of every change to what the harness executes.

## What a run reads

- **The default branch's tree, never the pull request's.** The checkout is the event's base commit. Every file Claude Code executes or obeys (`CLAUDE.md`, `.claude/`, `.mcp.json`) is therefore one that was already merged. The action also restores those paths from the base branch on pull-request events; this workflow does not rely on that.
- **The change as a diff**, fetched through the API for the event's two commits and written to `.review-input/pr.diff`. An empty diff, or one over 400 kB, is a hold. A file the pull request adds is read from the diff, not as a file.
- **The standards**: `CLAUDE.md` (§ "Conventions for new code" and § "Key conventions" first) and the findings catalogue. An empty § "Conventions for new code" reviews against nothing of yours.
- **Not** the pull request's title, description or comments: the prompt names no text a person typed.

## What a run may do

- **Read, Grep and Glob only.** `--allowedTools` lists them; Bash, file edits, web access and sub-agents are denied by name. Settings deny reading `/proc`, `/sys`, `/etc`, the runner's temporary directory, Claude's own configuration and `.git/`. Whether a read outside the working directory is refused without those rules was not tested here: they are there so that the answer does not matter.
- **No GitHub tool.** With an explicit prompt and no GitHub tool allowed, the action configures no MCP server (read at the pinned commit).
- **The job token, `contents: read`.** It dies with the job. The checkout keeps it in git's configuration because the action fetches the base branch before setting up its own authentication.
- **The Claude token.** Assume a steered session could reach anything in its process's environment; what bounds the risk is that it has no tool that writes or sends anything. Its only output is the verdict.

## The verdict

The session returns JSON against a fixed schema: `pass` or `hold`, a two-sentence summary, findings marked `blocking` or `minor`. A second job, with no Claude in it and `pull-requests: write`, posts the verdict as a comment inside a fenced block (its backticks replaced, so the model's text renders as text and mentions nobody) and fails the run unless the verdict is `pass`. A review job that failed, timed out or returned nothing usable is a hold.

A held pull request waits for a human: read the comment, then fix and push (a new run follows) or merge by hand.

## What is not reviewed

- **Documentation-only pull requests**: the trigger skips the paths the CI workflow skips, and takes the Claude instruction files back. Keep the two lists identical.
- **Forks**: their runs get no secret. **Dependabot**: its runs get no secret either, and its pull requests have their own gate.
- **Pull requests a bot opens**: the action refuses to start for an actor that is not a user unless `allowed_bots` names it. As shipped, such a run fails, which holds the pull request. Name a bot there only after reading `docs/security.md` of the action at the pinned commit.
- **Pull requests to another branch** are reviewed too: the trigger has no `branches:` filter, so that the file is byte for byte the same in every project.

## Merging unattended

A flow that merges on green must wait for this run as well as for CI. The kit's unattended merge does so by itself when `.github/workflows/claude-review.yml` exists on the default branch: it reacts to both workflows and merges only once the latest run of each is green for the same commit. Any other merge automation must do the same, or it merges before the review is in.

## Who already holds the secret

On a `pull_request` event from a branch of the repository, GitHub runs the workflow file **as the pull request writes it**, with the repository's secrets. Anyone who can push a branch can therefore already run a workflow that reads `CLAUDE_CODE_OAUTH_TOKEN`; this workflow adds no holder. It also means a pull request that edits `claude-review.yml` is reviewed by its own copy: such a pull request is never merged unattended (the merge gate holds `.github/workflows/claude*.yml`), and CR-1 goes red in its CI unless the same pull request updates the digest in the guard, which the merge gate holds too.

## Private repositories only

The comment and the run log are as visible as the repository. On a public repository, anyone can open a pull request; a fork gets no secret, but a collaborator's branch that carries an outsider's text does. Do not enable this workflow on a public repository as it stands.

## On every bump of `claude-code-action`

A bump is a hand merge (the file is gated). At the new commit, re-read what decides the properties above: the entry point and its inputs (`action.yml`), the mode chosen for a `pull_request` event with a prompt, which MCP servers that mode configures, how it obtains and configures the GitHub token and git, `--json-schema` and the `structured_output` output, the human-actor check, and the Claude Code version it installs. Then re-run the two throwaway pull requests.

## Checks

`scripts/guards.d/45-claude-review.sh`:

- **CR-1** — `claude-review.yml` is byte for byte the reviewed file, pins aside. A deliberate change updates `CLAUDE_REVIEW_DIGEST` in the guard, in the same pull request; the guard prints the new value.
- **CR-2** — `claude-review.yml` and `claude.yml` are the only workflows that name a Claude secret or action, no workflow reads all the secrets, and `claude-review.yml` has a top-level `permissions: {}`.
- **CR-3** — the checks can fail: a table of broken copies must all go red (the pull request's tree checked out, Bash allowed, forks let in, a third Claude workflow…), a pin bump must stay green.

They stop a regression, not a deliberate edit by someone who can change the guard too. That is what the human merge of workflow and guard changes is for.

## History

- Installed with the kit.
