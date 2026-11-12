# Rework of held pull requests

**Rule:** when the automated review holds a pull request, `claude-rework.yml` proposes a fix of its blocking findings as a separate pull request **into the held one**, for a human to merge. The Claude session only reads and edits files; a job without Claude decides what is pushed. Two attempts per pull request, then `needs-human`. A change to the file updates the digest in `scripts/guards.d/47-claude-rework.sh` and is merged by hand.

## Status

**Never run live by the kit's authors.** Written from the action's source at the pinned commit and from GitHub's documentation; the guard is tested, the workflow is not. Hold a throwaway pull request on purpose (a deliberately broken rule of `CLAUDE.md`), then read the rework run and the pull request it opens before relying on it.

## Why

A review that holds a pull request leaves work for someone. The cheapest next step is a proposal: a session that reads the findings and fixes what they name, and nothing else. What it must not do is decide on its own that its fix is good, or hold the means to land it: it writes a separate pull request, and a human merges it into the held one. That merge is a push to the held branch, which starts CI, the review and the unattended merge again.

## How it runs

- **Started by** the end of a review run that held (`workflow_run` on `Claude review`, conclusion `failure`), and only a review run that `workflow_run` itself started from `.github/workflows/claude-review.yml`. So this file always runs as the default branch holds it, and the run it reacts to was the default branch's review.
- **Its input** is the artifact `claude-review-verdict` of that review run: the pull request, the commit, the verdict, the findings. Not a comment: any workflow of the repository can post one. A run without that artifact (a failed review job, not a hold) does nothing.
- **`prepare`** (no Claude; `actions: read`, `pull-requests: write` for one comment) goes on only for a hold with blocking findings, on a pull request that is open into the default branch at exactly the held commit, from a branch of this repository, not labelled `needs-human`, and not itself a branch a Claude session wrote in CI (`claude/issue-*`, `claude/rework-*`). It counts the earlier attempts two ways and keeps the larger: the marker comment each attempt posts as soon as it is decided (`Automated rework started, attempt k/2`), so that an attempt which ends without a pull request still counts, and the pull requests attempts opened (`claude/rework-pr-<n>-1`, `-2`), should markers be deleted.
- **`rework`** (Claude; `contents: read`) checks out the default branch at the root and the pull request's commit under `.rework/pr`, as data, then makes that tree plain files: every `.git` and every symbolic link is removed (git would read a configuration the session could write; an edit through a link would land outside), and a pristine copy is kept outside the workspace. The session's tools are Read, Grep, Glob, Edit and Write; reads are approved in the workspace, edits under `.rework/pr` only, and a `.git` there is denied: no Bash, no Skill, no sub-agent, no web. It runs none of the pull request's code. A link or a `.git` it creates stops the run. The change passed on is the difference between the pristine copy and the edited tree, computed outside any repository and with no system or global git configuration.
- **`propose`** (no Claude; `contents: write`, `pull-requests: write`) applies that difference on the held commit and refuses it whole if any changed path matches a held path (`REWORK_HOLD_RE`: instruction files, hooks, tool configs, the gate and its guards, scanner configs, the findings catalogue, convention pages, every workflow), or holds a control character, or if the change adds a link or a submodule or changes a file mode. Paths are read unquoted and NUL-separated, without rename detection, so that a non-ASCII name or a rename into or out of a held path is judged like any other. It commits as `github-actions[bot]`, pushes one branch with an empty lease — refused if the branch already exists — and opens the pull request into the held branch, listing the files in a fenced block. A push with the job token starts no workflow, and the pull request's base is not the default branch: an unattended merge that only merges into the default branch never takes it, and the kit's own also refuses `claude/rework-*` heads.
- **`needs-human`**: once two attempts exist, it comments once and adds the label.

## What a run holds, and what bounds it

- **The Claude token, in the `rework` job only**, with a read-only job token. A steered session has no tool that runs or sends anything; what it can do is edit files under `.rework/pr`, which a job without Claude filters and a human reads. That is also a way out: whatever it can read, it can copy into a file of its change. Reads are approved in the workspace and denied for the runner's temporary and action directories, Claude's configuration, `/proc`, `/sys`, `/etc` and `.git/`; the Claude token is in the process environment only. Read the diff of a rework pull request before merging it, as you would any other.
- **The pull request's text reaches the session as data**: its code, any `CLAUDE.md` or instruction file under `.rework/pr` it opens, and the findings, which the review wrote from the pull request's diff. A steered session can propose a bad fix; it cannot land one.
- **A write token, in the `propose` job only**, with no model in it: it pushes the branch its inputs name, after checking that it is a new one under `claude/rework-pr-`.
- **No test is run by the rework.** The proposal is checked by a human, then by CI and the review once merged into the held branch.

## The cap is a brake, not a lock

Two attempts, then a human, against a session that keeps failing. Someone with write access can delete the marker comments (the pull requests attempts opened still count), or open pull requests under the attempts' branch names to use the count up: the cap bounds cost and noise from the automation, not what a person with write access can do.

## Setting it up

- `claude-review` installed and working: this workflow reads its verdict artifact.
- The repository secret `CLAUDE_CODE_OAUTH_TOKEN`, as for the review.
- The label `needs-human`, which the hand-over adds.
- A private repository. The pull requests and comments it writes are as visible as the repository.

## On every bump of `claude-code-action`

Re-read, at the new commit, what the review's page lists, plus how `--allowedTools` patterns such as `Edit(.rework/pr/**)` are passed to Claude Code, and which tools `--tools` leaves available. Then hold a throwaway pull request again.

## Sources

- [anthropics/claude-code-action](https://github.com/anthropics/claude-code-action), MIT licence, read at the pinned commit `f27be6b` (v1.0.252): agent mode on `workflow_run` (no MCP server without GitHub tools, no configuration restore outside pull-request events), the actor checks. The pins are copied from this kit's `claude.yml` and `security.yml`.
- [Claude Code scheduled tasks](https://code.claude.com/docs/en/routines), [Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web) and [cloud environments](https://code.claude.com/docs/en/cloud-environments), read on 2026-11-12: why the rework does not run there — a task started by a pull request event starts from the pull request's head commit, loads its settings and hooks, and pushes with the owner's GitHub identity through a proxy that does not limit branches.
- [mattpocock/skills](https://github.com/mattpocock/skills), MIT licence, read at commit `5863806` (2026-11-12): the rework task of `skills/in-progress/software-factory/EXAMPLE-TASKS.md` (fix only what the review named, a set number of fails before a human). Ideas only; no text was copied.

## Checks

`scripts/guards.d/47-claude-rework.sh`:

- **RW-1** — `claude-rework.yml` is byte for byte the reviewed file, pins aside. A deliberate change updates `REWORK_DIGEST` in the guard, in the same pull request.
- **RW-2** — the review keeps its verdict as the artifact `claude-review-verdict`.
- **RW-3** — the checks can fail: started by the pull request, Bash made available, edits anywhere, a third attempt, held paths let through, an existing branch pushed to, names quoted again, links and modes let through, a `.git` kept in the tree, failed attempts not counted, the verdict not kept — all go red; a pin bump stays green. Any edit to the workflow trips the digest, so the table proves the digest catches each change, not that each property has its own check.

CR-2 (`45-claude-review.sh`) and, with `claude-ci`, CC-2 let `claude-rework.yml` hold the Claude secret only next to this guard.

## History

- Installed with the kit.
- A first version ran in a Claude Code scheduled task started by a label. A fresh-context review showed, from the product's documentation, that such a task starts on the pull request's own files, hooks included, with the owner's full GitHub identity. Moved to this workflow before any release.
- After a fresh-context review of the Actions version: non-ASCII names went past the held-path filter (git quoted them), git ran on a tree the session could write, an attempt that opened no pull request did not count, the push could add to an existing branch, and the pull request listed model-chosen names unfenced. Fixed above; the cap is now stated as a brake.
