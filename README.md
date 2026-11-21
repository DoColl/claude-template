# claude-template

A modular harness for working on a codebase with [Claude Code](https://code.claude.com/docs): the instruction file, sub-agents, hooks, a local gate and the CI around them. A project installs it module by module and takes only what it uses.

It is distilled from a production codebase where each piece was added after something went wrong. The kit makes no assumption about your stack: what only your project knows is left as a marked gap for you to fill.

## The idea

1. **A rule that matters is a check.** A sentence in an instruction file is followed until the day it is not. Every fixed bug or review finding gets an ID, a line in a catalogue and a guard; one script runs the guards locally and in CI.
2. **`CLAUDE.md` is a budgeted index.** It is loaded into every session, so it holds operative rules only, under a byte budget that a guard enforces. Reasons and history live in `docs/conventions/`, read on demand.
3. **An orchestrator and specialists.** The main session decides and reviews; lighter models implement, run the tests and check the docs. A sub-agent is briefed like a peer and its result is verified, and the read-only ones are confined by a hook rather than by wording.
4. **The harness is privileged code.** Instruction files, agents, hooks and workflows are executed by every session. They are tested, pinned, reviewed like a change of privilege, and never merged unattended.
5. **What waits on a human is gathered.** Hand merges, red or missing runs and dated follow-ups land in one weekly issue instead of being discovered by asking.

## Quick start

Requirements: Node 20 or later, git and bash. Clone this repository anywhere, then from your project:

```bash
node /path/to/claude-template/bin/harness.mjs init .
```

In a terminal it lists the modules and asks which to install. Without one, name them:

```bash
node /path/to/claude-template/bin/harness.mjs init . --modules git-hooks,agents,security-review
```

A new repository on GitHub that will work through pull requests can take the day-1 set, the CI and the unattended merge in one run, and so in one installation pull request instead of two:

```bash
node /path/to/claude-template/bin/harness.mjs init . --modules git-hooks,agents,security-review,ci-security,ci-workflow,auto-merge
```

`ci-workflow` writes the CI workflow under the name `auto-merge` waits for (`CI`, or `--set CI_WORKFLOW=<name>`), so the two agree without an edit. Leave `ci-workflow` out if the project already has a CI workflow, and read `docs/conventions/auto-merge-policy.md` before the first pull request: from then on, green means merged.

The installer prints what it wrote and what is left for you. Then:

1. Fill the gaps it lists (`status .` shows them again): the project overview, the commands, the sensitive areas and the conventions in `CLAUDE.md`, the verification commands of the agents.
2. Run `git add -A`, then `./scripts/security-checks.sh --offline`. It must pass. (Several guards read what git tracks; before the first `git add` they only say so.)
3. Read what was installed before committing it. Every session will execute these files.

Later, as the project grows:

```bash
node /path/to/claude-template/bin/harness.mjs add . --modules ci-security   # another module
node /path/to/claude-template/bin/harness.mjs status .                      # installed modules, edited files, gaps left
node /path/to/claude-template/bin/harness.mjs update .                      # refresh the kit files you have not edited
node /path/to/claude-template/bin/harness.mjs update . --check              # write nothing; exit 3 when the project is behind the kit
node /path/to/claude-template/bin/harness.mjs update . --modules agents     # one module at a time
node /path/to/claude-template/bin/harness.mjs update . --only scripts/guards.d   # or one file, or one directory
node /path/to/claude-template/bin/harness.mjs update . --merge              # merge a kit file you edited with the kit's new version
node /path/to/claude-template/bin/harness.mjs update . --set TEST_HOLD_RE='(^|/)tests?/'   # change a setting of the installation
```

Running `init` again is safe: files already in place are left alone.

A repository that already has its own hooks, guards or workflows at the paths the kit writes takes `adopt` instead of `init`:

```bash
node /path/to/claude-template/bin/harness.mjs adopt . --modules git-hooks,ci-security --dry-run
node /path/to/claude-template/bin/harness.mjs show . scripts/security-checks.sh --modules core | diff - scripts/security-checks.sh
```

`adopt` writes what `init` would, except that a kit file the project already has with other content stays as it is and is recorded as a kit file edited in the project. The report sorts them by distance from the kit's version; `status` and the advisory guard HD-1 keep listing them, and `update` reports a conflict when the kit later changes one. The report counts, module by module, what is created, identical, adopted and kept. Sections for an instruction file that has no slot are named, to paste by hand; `--decline-fragments` records them as declined instead, when the project's file already covers them. Adopting does not make the project's version pass the kit's guards: run the gate and decide file by file which version stays.

## Modules

`core` is always installed. A module brings along what it requires.

| Module | Adopt | What it installs |
|---|---|---|
| `core` | day 1 | `CLAUDE.md` skeleton with its byte budget, `docs/` (conventions, ADR, runbooks), the findings catalogue and the `/retro` skill that feeds it at the end of a session and drafts an issue for the kit when the fault is in a kit file, the gate `scripts/security-checks.sh` and its `guards.d/` |
| `git-hooks` | day 1 | `pre-commit` (gitleaks on staged changes) and `pre-push` (the gate, offline) |
| `session-settings` | day 1, opt-in | a `.claude/settings.json` that denies reading `.env` files and `secrets/`, turns on the Bash sandbox without dropping a prompt, and a guard against the settings that widen every session |
| `parallel-sessions` | day 1, opt-in, when several sessions share the repository | a read-only report of how far a branch is behind the default branch and which files it shares with the branches of the other worktrees, a skill to sync and to warn another session, a commented `.worktreeinclude`, and a guard that keeps session worktrees out of git |
| `agents` | day 1 | `implementer`, `verifier`, `doc-sync` and `reviewer` agents, and the tested Bash allowlist that confines the read-only ones |
| `security-review` | day 1 | `security-reviewer` agent (fresh context, read-only), the project review skill, and a check that Claude Code plugins stay at the commit that was reviewed |
| `ci-security` | first CI | `security.yml` in two tiers, GitHub Actions rules with zizmor at zero, pinned scanners, a Dependabot skeleton |
| `ci-workflow` | first CI, when the project has no CI workflow yet | a seed `ci.yml` that runs on every pull request with no path filter: its first job calls `security.yml`, and a `changes` job lets the costly jobs skip on documentation (CW-1..3) |
| `node-audit` | first CI, Node projects | an `npm audit` gate with per-advisory derogations |
| `auto-merge` | pull-request flow | unattended squash-merge on green CI (and a green automated review where `claude-review` is installed), with the gates that hold instruction files, CI-session branches, risky bumps and — once the project names its tests — changes that delete or rewrite existing test lines, for a human |
| `claude-review` | pull-request flow | an automated, read-only Claude review of every code pull request, started once its CI is green; with `auto-merge`, a merge waits for CI and the review |
| `claude-rework` | pull-request flow | when the review holds a pull request, a read-and-edit-only Claude session proposes a fix of its blocking findings as a pull request into the held one, pushed by a job without Claude; two attempts, then `needs-human` |
| `ready-on-green` | pull-request flow, without `auto-merge` | a draft pull request is marked ready for review once its CI run is green; nothing is merged |
| `weekly-digest` | pull-request flow | one issue a week listing what waits on a human |
| `eco-design` | pull-request flow | the green-claude audit (eco-design rules drawn from RGESN and GR491) of what each pull request changes, at a pinned commit: annotations and a job summary for the findings it adds, a failing check past a level you set |
| `claude-ci` | on demand | `@claude` on plain issues of a private repository, with the job token only |
| `openspec` | on demand | the OpenSpec convention (specs for current behaviour, changes for work in flight) and its validation guard |
| `headroom` | on demand | how to run the Headroom compression proxy on one machine (pinned install, a launch script with a clean environment and the egress switches), and a guard that keeps proxy routing, Headroom wiring and its local state out of git |

`node bin/harness.mjs list` prints the same with each module's requirements.

## What has been exercised

Each module's convention page says where its piece comes from and what has actually run. In short:

| Piece | Status |
|---|---|
| The installer | Tested: `test/` installs every module alone and all together into scratch projects and runs their gate. |
| Bash allowlist of the agents | The decision logic comes from production. This kit's variant reads the verification commands from a config file and carries a fix the review below produced; it is covered by its test table, and must be checked live once in your project (`docs/conventions/agent-bash-guard.md` § Live check). |
| `session-settings` | Written from Claude Code's documentation. The guard is tested; the settings file has never been read by a live session here. Its page has a live check. |
| `parallel-sessions` | Written for the kit. The report and the guard are tested in scratch repositories with several worktrees, and have run on the kit's own repository. The skill has never been loaded by a session; what its page says of Claude Code comes from the documentation and was not observed. |
| Agents, review skill, plugin pins | Adapted from production; the wording is new where project specifics were removed. |
| `security.yml`, zizmor rules | Ported from production workflows. This generic variant has run on the kit's own repository: the enforcing tier (gitleaks, then the gate with zizmor) called from CI on pull requests and on a push, and one standalone run of both tiers, Semgrep, Trivy and the SBOM included, on a documentation push. The weekly schedule and the manual dispatch have not fired yet. |
| `npm audit` gate | Ported from a production workflow. This generic variant has not run on GitHub yet. |
| `ci-workflow` | An earlier shape, with a path filter, ran once live in a throwaway private repository: a run on `edited` after a retarget was watched. The current shape — no path filter, the `changes` job and its guard — is unit-tested only. |
| `auto-merge` | The original runs in production. This generic variant ran once live, with `claude-review`, in a throwaway private repository: it merged docs-only and code pull requests (the latter only after CI and the review), a retargeted one, and held an instruction file, a Dependabot bump of the Claude action and every held review. A second live run, with `TEST_HOLD_RE` set through the installer: a pull request that only adds a test merged on green, and one that rewords a line of an existing test passed the review and was held by the gate, its draft lifted. A pull request that removes an assertion was held earlier, by the review. No enforced ruleset was exercised. On the kit's own repository it is uninstalled, its ruleset not being enforced. The range read from the base branch's tip, which replaced `base.sha` after those runs, ran in a third live run, with heads and tips that had two merge bases, which saw GitHub's merge start from the merge base its compare names; the hold of a listing of 300 files, the reads before each merge call and the check of what the merge wrote have run only against a local stand-in for the API. The documentation job seen in those runs is gone: every merge now waits for CI (AM-11), unit-tested only. |
| `/retro` skill | Written for the kit. Its closing form ran once, at the end of a session on the kit itself, and led to four issues there, posted after a yes. Not run in an installed project that cannot reach the kit's repository; the full form has not run. |
| `claude-review` | Run live twice, in throwaway private repositories: the chain CI → review → merge fired, conforming changes passed and breaking ones held, with correct findings; in the second run, with `auto-merge`'s `TEST_HOLD_RE` set, it passed a reworded line of an existing test and held the removal of an assertion. A review re-run that passes was not exercised; the first-attempt rule is tested on tables only. Nor has the diff read from the default branch's tip, which replaced `base.sha` after those runs, been exercised. |
| `weekly-digest` | Unit-tested. Ran once live, on the kit's own repository: the scheduled trigger fired on its day, hours late, and the digest was posted as an issue, labelled and assigned, with one section — the scheduled runs. Its other sections had nothing to list, no previous digest was there to close, and whether the assignment notified was not seen. |
| `ready-on-green` | Ran live on the kit's own repository. The job found the pull request, and GitHub refused to lift the draft with `pull-requests: write` alone, twice: the second time on the commit adding `contents: write`, which a `workflow_run` workflow only uses once it is on the default branch. Since then it has lifted the drafts of several pull requests whose CI was green. Its steps are the ones `auto-merge` uses to lift a draft, which ran live with that workflow. Its guard was tried by hand in a scratch project: five ways of widening the workflow, each one red. |
| `claude-rework` | Run once live, in a throwaway private repository: a hold led to a rework pull request into the held branch, merged by a human, then a pass and an unattended merge. The run found two defects, both fixed since (a missing permission; a second attempt on a re-run review). The `needs-human` hand-over and the held-path refusals were not exercised. |
| `claude-ci` | Not exercised end to end; only its push hook was replayed locally, against the push wrapper of the pinned action. For private repositories only. |
| `openspec` guard | Its validation command was run against OpenSpec CLI 1.10.0 in one installed project (an empty project, a scaffolded change, a valid change, a spec alone), and the guard itself in a scratch project (a change with no delta stays red until it declares `skip_specs: true`). Its runner path — install the CLI its lockfile pins with `npm ci`, then validate — was run on a laptop with `CI` set, against the npm registry; never on a hosted runner, and the kit's tests run it with stand-ins for npm and the CLI. |
| `eco-design` | Ran once live, on the kit's own pull request that added it: green-claude fetched at the pinned commit, the 8 changed files of covered kinds audited, 12 new findings reported as annotations and in the log, ECO-HEB-06 left out, the check green with `fail_on: none`. A first run had stopped on the shape of the real rule catalogues, fixed since. The script is unit-tested against a stand-in of the audit. The inventory, a blocking level and a required check have not run. |
| `headroom` | Written from Headroom 0.44.0's source, read and never executed. Its launch script ran once against a stand-in `headroom` (environment, arguments, refusals); the real proxy was not started and no session went through it. The guard is tested on tables, and was reviewed adversarially four times: each pass found bypasses the previous one had missed, until the guard was changed to read every committed file rather than model what Claude Code loads; the fourth pass confirmed its findings by running Claude Code with a stand-in `headroom`. What it still does not see is listed on the page. Its page lists what is unknown and has a live check. |

Treat anything marked "has not run", and every part of a piece this table does not say has run, as a draft until you have watched it work once.

One fresh-context security review has been run on the kit, on the Bash allowlist, `auto-merge`, `claude-ci`, the installer, the security workflow and the digest. What it confirmed is fixed: a bypass of the allowlist through shell comments, a merge gate that judged the pull request's live listing instead of the commits being merged, writes through a symlink leaving the project, and claims in the pages that were wider than the code. One point it left open, what a CI session can push, was settled afterwards by reading the action at the pinned commit. It did not read `node-audit`, `openspec`, `parallel-sessions`, `headroom`, `security-review`, `session-settings` or the smaller guards, and it predates the `TEST_HOLD_RE` gate of `auto-merge`. Later reviews, of installed projects and of the kit against fixes a derived project made, found more in the same pieces, each fixed with its tests: the allowlist split words on whitespace the shell does not split on, which let a read-only agent run any program, and the merge gate left unheld files that decide what a scanner or the audit reports, and listed the range from a base commit GitHub does not move with the branch. One review is not an audit.

## Sources and credits

Most of the kit is distilled from one production codebase, which stays unnamed. Pieces drawn from public sources name them on their convention page (§ Sources) and here:

| Source | Licence | Read at | What the kit took |
|---|---|---|---|
| [anthropics/claude-code-action](https://github.com/anthropics/claude-code-action) | MIT | `f27be6b` (v1.0.252) | The action that `claude-ci` and `claude-review` pin; for `claude-review`, the base-ref checkout pattern and the behaviour read in its source (`docs/conventions/claude-review.md` § Sources). |
| [mattpocock/skills](https://github.com/mattpocock/skills) | MIT | `5863806` (2026-11-12) | The idea of the `/retro` skill and of the retrospective task (`docs/conventions/local-gate.md` § Sources); the three brakes of an automated flow, behind `claude-review`, and the rework task, behind `claude-rework` (their pages, § Sources). Ideas only, no text copied. |
| [Claude Code documentation](https://code.claude.com/docs/en/routines) | — | 2026-11-12 | Why `claude-rework` does not run as a scheduled task: where such a task starts and what identity it pushes with (`docs/conventions/claude-rework.md` § Sources). |
| [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec) | MIT | npm package 1.10.0 (2026-11-13) | For `openspec`: the CLI's telemetry and update-check switches, the `allowed-tools` line of the files it generates and what three of its subcommands do, read in the published package without running it (`docs/conventions/openspec-workflow.md` § Sources). No text copied. |
| [Claude Code documentation](https://code.claude.com/docs/en/skills) | — | 2026-11-13 | For `openspec`: how long an `allowed-tools` grant lasts, that a skill Claude invokes on its own grants it too and that workspace trust does not gate it, and how a Bash permission rule is matched (`docs/conventions/openspec-workflow.md` § Sources). No text copied. |
| [Claude Code documentation](https://code.claude.com/docs/en/worktrees) | — | 2026-11-13 | For `parallel-sessions`: what a worktree shares with the main checkout, the base a new worktree starts from, `.worktreeinclude`, how a message from another session is treated (`docs/conventions/parallel-sessions.md` § Sources). No text copied. |
| [arXiv:2607.04697](https://arxiv.org/abs/2607.04697), Xu, Subramanian and Karthik | — | 2026-11-13 (abstract) | The rates of conflict between pull requests written by agents, quoted on the `parallel-sessions` page. |
| ["When Agents Collide"](https://codex.danielvaughan.com/2026/07/28/agent-pr-merge-conflicts-concurrent-coding-agents-codex-cli-worktree-isolation-coordination-defence/), D. Vaughan | none stated | 2026-11-13 | For `parallel-sessions`: forecasting a conflict between two agents' branches with `git merge-tree`, one set of files per agent, making what an agent holds visible to the others. Ideas only. |
| [obra/superpowers](https://github.com/obra/superpowers) | MIT | `22f0b46` (2026-11-13) | For `parallel-sessions`: the run of the project's checks in a fresh worktree before any change, and the check that the worktree directory is ignored, which PS-1 makes a guard. Ideas only, no text copied. |
| [Institut-du-Numerique-Responsable/green-claude](https://github.com/Institut-du-Numerique-Responsable/green-claude) | Apache-2.0 (code), CC BY 4.0 (rules, documentation) | `bc2a1cf` (2026-11-13) | The audit `eco-design.yml` fetches at that commit and runs, not copied; its rule titles and recommendations appear in the job summary with their credit (`docs/conventions/eco-design.md` § Sources). |
| [headroomlabs-ai/headroom](https://github.com/headroomlabs-ai/headroom) | Apache-2.0 | `headroom-ai` 0.44.0 (`b21479e`) and `9f2cc01`, 2026-11-13 | The commands, flags, environment variables and behaviour the `headroom` page describes, read in its code (`docs/conventions/headroom.md` § Sources). No text or code copied. |
| [Claude Code environment variables](https://code.claude.com/docs/en/env-vars), [MCP tool search](https://code.claude.com/docs/en/mcp) | — | 2026-11-13 | The variables that move a session's API traffic, which the `headroom` guard refuses in committed files, and tool search behind a gateway (`docs/conventions/headroom.md` § Sources). |
| [changesets/changesets](https://github.com/changesets/changesets) | MIT | `main`, 2026-11-14 (README, `docs/guide/getting-started.md`) | For the kit's own releases (`bin/release.mjs`, `changes/`): one Markdown file per change, whose header gives its semver bump (`patch`, `minor` or `major`) and whose text is the summary written to the changelog. An idea; no code or text copied. |
| [twisted/towncrier](https://github.com/twisted/towncrier) | MIT | `trunk`, 2026-11-14 (README, `docs/tutorial.rst`) | For the kit's own releases: fragments kept in a directory and read instead of one file that every contributor writes to and that produces merge conflicts; a build that writes them into the changelog and removes them, and a draft mode that writes nothing (`--dry-run`). An idea; no code or text copied. |
| [actions/runner-images](https://github.com/actions/runner-images) (`images/ubuntu-slim/ubuntu-slim-Readme.md`) and [GitHub Docs](https://github.com/github/docs) ("GitHub-hosted runners", § Single-CPU runners) | MIT; CC BY 4.0 (content) | `f642dfb` (2026-11-13); `6946b3e` (2026-11-12) | For `LIGHT_RUNNER` (§ Actions minutes): what the `ubuntu-slim` image carries (bash, git, jq, the GitHub CLI, Node.js 24, Python and pipx), that it runs a job in an unprivileged container and stops it at 15 minutes. |
| [GitHub Docs](https://github.com/github/docs) ("Changing the base branch of a pull request", "Pull requests") | CC BY 4.0 (content) | `main`, 2026-11-14 | For `auto-merge` and `claude-review`: that a pull request's base commit is set when it is opened and does not move with the branch, and that GitHub's compare pages and pull request pages may show different changed files, each from its own merge base, which the kit assumes of the API too (`docs/conventions/auto-merge-policy.md` § Sources). No text copied. |

## What lands in your project

With every module installed:

```
CLAUDE.md                          the budgeted instruction file (yours)
SECURITY_REVIEW.md                 the findings catalogue (yours)
.worktreeinclude                   the ignored files a new worktree needs (yours)
.claude/
  agents/                          implementer, verifier, doc-sync, reviewer, security-reviewer
  hooks/                           the Bash allowlist, its tests, its config (yours)
  rules/                           rules loaded only when a session touches the files they name
  skills/project-security-review/  the project's review skill (yours)
  skills/retro/                    the retrospective that feeds the findings catalogue
  skills/parallel-sessions/        syncing with the default branch and with the other sessions
  settings.json                    secret files denied, Bash sandbox (yours)
  harness.json                     what the installer did
.githooks/                         pre-commit, pre-push
.github/
  workflows/                       ci.yml (yours), security.yml, auto-merge.yml, ready-on-green.yml, weekly-digest.yml, eco-design.yml, claude.yml, claude-review.yml
  dependabot.yml, zizmor.yml
docs/
  conventions/                     one page per rule: the detail behind CLAUDE.md
  adr/, runbook/                   templates and indexes
scripts/
  security-checks.sh               the gate
  parallel-sessions.sh             what moved under a branch, what the other worktrees hold
  guards.d/                        one guard per family of checks; 50-project.sh is yours
```

Files marked "yours" are created once and never touched again. The others are the kit's machinery: `update` refreshes them as long as you have not edited them, and tells you when you have.

## How installation works

- **Seeds and kit files.** A seed is a skeleton the project fills in. It is created once and never overwritten, not even with `--force`. A kit file is recorded with a hash in `.claude/harness.json`, which is how `status` shows the ones you edited and `update` knows which it may refresh. In the project, without the kit, the advisory guard HD-1 lists the same edited files on every run of the gate: a kit file still identical to its hash was reviewed in the kit and need not be reviewed again in the project.
- **Slots.** Seeds carry comment lines such as `<!-- harness:slot delegation -->`. A module inserts its section there, once, and the line stays so that a module added later finds it. Claude Code does not send block-level HTML comments in `CLAUDE.md` to the model, so they cost nothing in context.
- **Placeholders.** A few values (project name, default branch, the name of your CI workflow) are asked at install time and checked against a strict pattern before anything is written.
- **Gaps.** What the kit cannot know is a `TODO(harness)` comment. `status` and an advisory guard count them.
- **Updates.** `update` takes everything the installed modules ship, or a selection: `--modules` for some of them, `--only` for a file or a directory. What a selection leaves out stays recorded as it was installed, and the next `update` or `update --check` lists it again. A file the kit no longer ships is removed when it is still as installed, and reported when the project edited it. The manifest records the kit's version and, from a git checkout, its commit, and only a full `update` writes it: until then `update --check` exits 3, even when every file is in step. `CHANGELOG.md` says what each version changed and what is left to do by hand, and `update` ends its report with those steps for the versions it crosses.
- **Settings.** A value the project decides inside a kit file — the patterns of `auto-merge.yml` — is a placeholder: `update --set KEY=VALUE` records it and renders the file again, so the file stays the kit's. No kit-owned script or workflow asks to be edited.
- **Merges.** A kit file the project did edit, and that the kit then changed, is a conflict; `update --merge` merges the two when they do not overlap. It finds the version that was installed in the kit's git history, by the hash the manifest recorded, so the kit must be a checkout with its history. An overlap is left to a human and nothing is written to the file.
- **Conflicts.** A file that already exists with other content is left alone and reported; the exit code is 2.

`docs/module-authoring.md` is the full contract, for writing a module of your own.

## From a Claude Code session

Copy `skills/harness-init/` into `~/.claude/skills/`, set `CLAUDE_TEMPLATE_DIR` to your checkout, and ask Claude to initialise the project with the harness. The skill runs the installer, asks which modules you want and helps fill the gaps from the codebase. Two more skills cover the rest of a project's life: `skills/harness-adopt/` for a repository that already has its own harness at the kit's paths, and `skills/harness-update/` to bring an installed project up to the kit's current version, wholly or by selection. The three were written for the kit. `harness-update` was followed once on a throwaway installation, from 0.1.0 to 0.5.0: a merge, one conflict, a setting, the steps to do by hand. `harness-init` and `harness-adopt` have not been run live.

## Why files and not a plugin

Most of the kit is not Claude configuration at all: scripts, git hooks, workflows, documentation. And the one piece that must not be optional, the hook that confines read-only agents, is declared in each agent's frontmatter, which Claude Code ignores for agents shipped by a plugin. Project files it is.

## Actions minutes

On a private repository GitHub bills each job's time rounded **up to the whole minute**, and a pull request in a project equipped with the kit runs many short jobs: CI, the merge, ready-on-green, the eco-design audit, the review's report. Most of such a bill is rounding, not work. The kit keeps it down three ways:

- **Light jobs on a one-CPU runner.** The jobs that need only bash, git, jq, the GitHub CLI and Node.js run on the runner the installation value `LIGHT_RUNNER` names — `ubuntu-slim` unless the project chose otherwise (`update <dir> --set LIGHT_RUNNER=ubuntu-latest`, or a self-hosted label): the CI skeleton's `changes` job, `auto-merge`, `ready-on-green`, the weekly digest and the eco-design audit. The review's report and the rework's orchestration jobs run on `ubuntu-slim` written in their files: those files are pinned by a digest (CR-1, RW-1), and a digest that accepted any runner label would accept one for the job that runs Claude too. GitHub sells that runner as the lower-cost option for short automation; it runs the job in an unprivileged container (no Docker-in-Docker, no job `container:`) and stops it at 15 minutes. The jobs that build, scan or run Claude stay on `ubuntu-latest`.
- **Jobs skipped rather than run.** A job skipped by its `if:` gets no runner and costs nothing: the CI skeleton skips its costly jobs on documentation (`docs/conventions/ci-workflow.md`), and the advisory scanners run only on the weekly schedule and by hand.
- **Steps folded into one job** where they always run together: the secret scan and the gate are one job, not two.

Two levers sit outside the kit. Standard GitHub-hosted runners are free on public repositories, and self-hosted runners cost nothing on GitHub's side. Usage per repository and per workflow can be read from the billing usage API, to see which workflow costs what.

Not done on purpose: `cancel-in-progress` on the CI workflow where `auto-merge` is installed. Cancelling a run is how a person holds a pull request there, and a title edit (an `edited` event) would cancel the run of the same commit, holding it until the next push.

## Limits

- The workflow modules are for GitHub. The rest works with any forge.
- The Bash allowlist is a tripwire against a steered or over-eager sub-agent, not a sandbox. Its page lists what it does not cover.
- That allowlist is a hook in each agent's frontmatter, and Claude Code runs such hooks only in a folder whose workspace trust prompt was accepted. A new clone, a new git worktree or a headless session in an untrusted folder runs the read-only agents unguarded.
- A guard stops a regression, not a deliberate edit by someone who can change the guard too. Review of the harness files is what covers that.
- The hook, the gate helpers and the digest need Node on the machine and on the runner.
- Nothing here replaces reading what you install.

## Working on the kit

```bash
node --test test/*.test.mjs     # unit tests, static rules on every module, end-to-end installs, the test project
node bin/release.mjs --dry-run  # the next release, from the changelog fragments in changes/
```

`CLAUDE.md` at the root of this repository holds the rules for changing the kit; `docs/module-authoring.md` the contract for modules.

**A real project, besides scratch ones.** `test/install.test.mjs` installs into empty folders; `test/factory.test.mjs` takes `DoColl/factory-test`, a small project that already runs the kit, at the commit `test/factory-test.json` pins. It updates a copy of it to the kit under test, then adds modules to it, and runs the project's gate and its own tests each time. The clone is read from `FACTORY_TEST_DIR`, else `../factory-test` next to the kit — from a git worktree, set the variable — and copied with `git archive`, never touched. Locally, a missing clone or commit skips the two tests with the reason; in CI (`CI` or `FACTORY_TEST_REQUIRED` set) it fails them, and CI checks the project out with a read-only token, `FACTORY_TEST_TOKEN`. When the test project moves to a new release of the kit, its merge commit becomes the new pin, in a pull request of the kit.

**A pull request leaves the version alone.** It adds a changelog fragment, `changes/<slug>.md` — its level, the lines of its entry and its "By hand" part, in the format given at the top of `CHANGELOG.md` — and touches neither `kit.json`, `package.json`, the version in `.claude/harness.json` nor `CHANGELOG.md`. Pull requests written in parallel then never edit the same lines for their entries, and none has to be renumbered when another one merges first. The tests check every fragment, and CI fails a pull request that changes `modules/`, `lib/` or `bin/` without adding one.

**A release is a pull request of its own.** From an up-to-date `main`, in a checkout without uncommitted changes, `node bin/release.mjs` takes the highest level among the fragments, writes the next version to `kit.json` and `package.json`, puts the entry at the top of `CHANGELOG.md` (the fragments' lines, then one "By hand" part), removes the fragments and runs `node bin/harness.mjs update .` for the root manifest; `--dry-run` shows the result and writes nothing. A test holds the version files, the root manifest and the changelog together. The pull request is reviewed and merged by hand like any other, and nothing follows the merge but the tag: `.github/workflows/release.yml` puts `v<version>` on the commit of `main` that changes `kit.json`, and never moves an existing tag. That workflow is the kit's own, not a module; it has tagged every release since 0.3.1. The command is covered by the kit's tests; it has cut every release since 0.8.1, each tagged by that workflow once merged. Its design follows changesets and towncrier (§ Sources and credits).

No workflow commits the version or opens the release pull request: a bot that writes to `main` without a pull request is a privilege the kit refuses itself, such a commit would start no CI, and a ruleset that forbids direct pushes would stop it; a pull request opened with a job's own token starts no CI either. The level sits in the fragment rather than in a label, so that it is in the diff, reviewed and checked by the tests.

The kit installs part of itself at its root — `core`, `parallel-sessions`, `ci-security`, `ready-on-green`, `weekly-digest` and `eco-design` — so `scripts/`, `docs/conventions/` and most of `.github/` here are installed copies of what `modules/` ships, recorded in `.claude/harness.json`. Change the module, then run `node bin/harness.mjs update .`. The statuses in "What has been exercised" change only once a piece has been watched working here.

## License and security

MIT, see `LICENSE`. To report a vulnerability in a piece of the kit, see `SECURITY.md`.
