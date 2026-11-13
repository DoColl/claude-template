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
| `agents` | day 1 | `implementer`, `verifier`, `doc-sync` and `reviewer` agents, and the tested Bash allowlist that confines the read-only ones |
| `security-review` | day 1 | `security-reviewer` agent (fresh context, read-only), the project review skill, and a check that Claude Code plugins stay at the commit that was reviewed |
| `ci-security` | first CI | `security.yml` in two tiers, GitHub Actions rules with zizmor at zero, pinned scanners, a Dependabot skeleton |
| `ci-workflow` | first CI, when the project has no CI workflow yet | a seed `ci.yml` whose first job calls `security.yml`, and whose pull-request filter keeps the Claude instruction files in |
| `node-audit` | first CI, Node projects | an `npm audit` gate with per-advisory derogations |
| `auto-merge` | pull-request flow | unattended squash-merge on green CI (and a green automated review where `claude-review` is installed), with the gates that hold instruction files, CI-session branches, risky bumps and — once the project names its tests — changes that delete or rewrite existing test lines, for a human |
| `claude-review` | pull-request flow | an automated, read-only Claude review of every code pull request, started once its CI is green; with `auto-merge`, a merge waits for CI and the review |
| `claude-rework` | pull-request flow | when the review holds a pull request, a read-and-edit-only Claude session proposes a fix of its blocking findings as a pull request into the held one, pushed by a job without Claude; two attempts, then `needs-human` |
| `weekly-digest` | pull-request flow | one issue a week listing what waits on a human |
| `claude-ci` | on demand | `@claude` on plain issues of a private repository, with the job token only |
| `openspec` | on demand | the OpenSpec convention (specs for current behaviour, changes for work in flight) and its validation guard |

`node bin/harness.mjs list` prints the same with each module's requirements.

## What has been exercised

Each module's convention page says where its piece comes from and what has actually run. In short:

| Piece | Status |
|---|---|
| The installer | Tested: `test/` installs every module alone and all together into scratch projects and runs their gate. |
| Bash allowlist of the agents | The decision logic comes from production. This kit's variant reads the verification commands from a config file and carries a fix the review below produced; it is covered by its test table, and must be checked live once in your project (`docs/conventions/agent-bash-guard.md` § Live check). |
| `session-settings` | Written from Claude Code's documentation. The guard is tested; the settings file has never been read by a live session here. Its page has a live check. |
| Agents, review skill, plugin pins | Adapted from production; the wording is new where project specifics were removed. |
| `security.yml`, zizmor rules | Ported from production workflows. This generic variant has run on the kit's own repository: the enforcing tier (gitleaks, then the gate with zizmor) called from CI on pull requests and on a push, and one standalone run of both tiers, Semgrep, Trivy and the SBOM included, on a documentation push. The weekly schedule and the manual dispatch have not fired yet. |
| `npm audit` gate | Ported from a production workflow. This generic variant has not run on GitHub yet. |
| `ci-workflow` | Run once live, in a throwaway private repository, with a test job added: the documentation skip, the re-inclusion of `CLAUDE.md` and a run on `edited` after a retarget were watched. |
| `auto-merge` | The original runs in production. This generic variant ran once live, with `claude-review`, in a throwaway private repository: it merged docs-only and code pull requests (the latter only after CI and the review), a retargeted one, and held an instruction file, a Dependabot bump of the Claude action and every held review. No `TEST_HOLD_RE` hold and no enforced ruleset were exercised. On the kit's own repository it is uninstalled, its ruleset not being enforced. |
| `/retro` skill | Written for the kit. Never run live, in its closing form (end of a session, an issue drafted for the kit) either. |
| `claude-review` | Run once live, in a throwaway private repository: the chain CI → review → merge fired, conforming changes passed and breaking ones held, with correct findings. A review re-run that passes was not exercised; the first-attempt rule is tested on tables only. |
| `weekly-digest` | Unit-tested. Never run live, in the project it comes from either. |
| `claude-rework` | Run once live, in a throwaway private repository: a hold led to a rework pull request into the held branch, merged by a human, then a pass and an unattended merge. The run found two defects, both fixed since (a missing permission; a second attempt on a re-run review). The `needs-human` hand-over and the held-path refusals were not exercised. |
| `claude-ci` | Not exercised end to end; only its push hook was replayed locally, against the push wrapper of the pinned action. For private repositories only. |
| `openspec` guard | Its validation command was run against OpenSpec CLI 1.10.0 in one installed project (an empty project, a scaffolded change, a valid change, a spec alone), and the guard itself in a scratch project (a change with no delta stays red until it declares `skip_specs: true`). Not run in CI: the kit installs no CLI there. |

Treat anything marked "has not run", and every part of a piece this table does not say has run, as a draft until you have watched it work once.

One fresh-context security review has been run on the kit, on the Bash allowlist, `auto-merge`, `claude-ci`, the installer, the security workflow and the digest. What it confirmed is fixed: a bypass of the allowlist through shell comments, a merge gate that judged the pull request's live listing instead of the commits being merged, writes through a symlink leaving the project, and claims in the pages that were wider than the code. One point it left open, what a CI session can push, was settled afterwards by reading the action at the pinned commit. It did not read `node-audit`, `openspec`, `security-review`, `session-settings` or the smaller guards, and it predates the `TEST_HOLD_RE` gate of `auto-merge`. One review is not an audit.

## Sources and credits

Most of the kit is distilled from one production codebase, which stays unnamed. Pieces drawn from public sources name them on their convention page (§ Sources) and here:

| Source | Licence | Read at | What the kit took |
|---|---|---|---|
| [anthropics/claude-code-action](https://github.com/anthropics/claude-code-action) | MIT | `f27be6b` (v1.0.252) | The action that `claude-ci` and `claude-review` pin; for `claude-review`, the base-ref checkout pattern and the behaviour read in its source (`docs/conventions/claude-review.md` § Sources). |
| [mattpocock/skills](https://github.com/mattpocock/skills) | MIT | `5863806` (2026-11-12) | The idea of the `/retro` skill and of the retrospective task (`docs/conventions/local-gate.md` § Sources); the three brakes of an automated flow, behind `claude-review`, and the rework task, behind `claude-rework` (their pages, § Sources). Ideas only, no text copied. |
| [Claude Code documentation](https://code.claude.com/docs/en/routines) | — | 2026-11-12 | Why `claude-rework` does not run as a scheduled task: where such a task starts and what identity it pushes with (`docs/conventions/claude-rework.md` § Sources). |

## What lands in your project

With every module installed:

```
CLAUDE.md                          the budgeted instruction file (yours)
SECURITY_REVIEW.md                 the findings catalogue (yours)
.claude/
  agents/                          implementer, verifier, doc-sync, reviewer, security-reviewer
  hooks/                           the Bash allowlist, its tests, its config (yours)
  skills/project-security-review/  the project's review skill (yours)
  skills/retro/                    the retrospective that feeds the findings catalogue
  settings.json                    secret files denied, Bash sandbox (yours)
  harness.json                     what the installer did
.githooks/                         pre-commit, pre-push
.github/
  workflows/                       ci.yml (yours), security.yml, auto-merge.yml, weekly-digest.yml, claude.yml, claude-review.yml
  dependabot.yml, zizmor.yml
docs/
  conventions/                     one page per rule: the detail behind CLAUDE.md
  adr/, runbook/                   templates and indexes
scripts/
  security-checks.sh               the gate
  guards.d/                        one guard per family of checks; 50-project.sh is yours
```

Files marked "yours" are created once and never touched again. The others are the kit's machinery: `update` refreshes them as long as you have not edited them, and tells you when you have.

## How installation works

- **Seeds and kit files.** A seed is a skeleton the project fills in. It is created once and never overwritten, not even with `--force`. A kit file is recorded with a hash in `.claude/harness.json`, which is how `status` shows the ones you edited and `update` knows which it may refresh. In the project, without the kit, the advisory guard HD-1 lists the same edited files on every run of the gate: a kit file still identical to its hash was reviewed in the kit and need not be reviewed again in the project.
- **Slots.** Seeds carry comment lines such as `<!-- harness:slot delegation -->`. A module inserts its section there, once, and the line stays so that a module added later finds it. Claude Code does not send block-level HTML comments in `CLAUDE.md` to the model, so they cost nothing in context.
- **Placeholders.** A few values (project name, default branch, the name of your CI workflow) are asked at install time and checked against a strict pattern before anything is written.
- **Gaps.** What the kit cannot know is a `TODO(harness)` comment. `status` and an advisory guard count them.
- **Updates.** `update` takes everything the installed modules ship, or a selection: `--modules` for some of them, `--only` for a file or a directory. What a selection leaves out stays recorded as it was installed, and the next `update` or `update --check` lists it again. A file the kit no longer ships is removed when it is still as installed, and reported when the project edited it. The manifest records the kit's version and, from a git checkout, its commit; `CHANGELOG.md` says what each version changed and what is left to do by hand, and `update` ends its report with those steps for the versions it crosses.
- **Settings.** A value the project decides inside a kit file — the patterns of `auto-merge.yml` — is a placeholder: `update --set KEY=VALUE` records it and renders the file again, so the file stays the kit's. No kit-owned script or workflow asks to be edited.
- **Merges.** A kit file the project did edit, and that the kit then changed, is a conflict; `update --merge` merges the two when they do not overlap. It finds the version that was installed in the kit's git history, by the hash the manifest recorded, so the kit must be a checkout with its history. An overlap is left to a human and nothing is written to the file.
- **Conflicts.** A file that already exists with other content is left alone and reported; the exit code is 2.

`docs/module-authoring.md` is the full contract, for writing a module of your own.

## From a Claude Code session

Copy `skills/harness-init/` into `~/.claude/skills/`, set `CLAUDE_TEMPLATE_DIR` to your checkout, and ask Claude to initialise the project with the harness. The skill runs the installer, asks which modules you want and helps fill the gaps from the codebase. Two more skills cover the rest of a project's life: `skills/harness-adopt/` for a repository that already has its own harness at the kit's paths, and `skills/harness-update/` to bring an installed project up to the kit's current version, wholly or by selection. The three were written for the kit; none has been run live.

## Why files and not a plugin

Most of the kit is not Claude configuration at all: scripts, git hooks, workflows, documentation. And the one piece that must not be optional, the hook that confines read-only agents, is declared in each agent's frontmatter, which Claude Code ignores for agents shipped by a plugin. Project files it is.

## Limits

- The workflow modules are for GitHub. The rest works with any forge.
- The Bash allowlist is a tripwire against a steered or over-eager sub-agent, not a sandbox. Its page lists what it does not cover.
- That allowlist is a hook in each agent's frontmatter, and Claude Code runs such hooks only in a folder whose workspace trust prompt was accepted. A new clone, a new git worktree or a headless session in an untrusted folder runs the read-only agents unguarded.
- A guard stops a regression, not a deliberate edit by someone who can change the guard too. Review of the harness files is what covers that.
- The hook, the gate helpers and the digest need Node on the machine and on the runner.
- Nothing here replaces reading what you install.

## Working on the kit

```bash
node --test test/*.test.mjs     # unit tests, static rules on every module, end-to-end installs
```

`CLAUDE.md` at the root of this repository holds the rules for changing the kit; `docs/module-authoring.md` the contract for modules.

A release is a version in `kit.json` and `package.json`, its entry at the top of `CHANGELOG.md` (a test holds the three together), `node bin/harness.mjs update .` for the root manifest, and nothing after the merge: `.github/workflows/release.yml` puts the tag `v<version>` on the commit of `main` that changes `kit.json`, and never moves an existing tag. That workflow is the kit's own, not a module; it ran once, on the merge that added it, and tagged that commit.

The kit installs part of itself at its root — `core`, `ci-security` and `weekly-digest` — so `scripts/`, `docs/conventions/` and most of `.github/` here are installed copies of what `modules/` ships, recorded in `.claude/harness.json`. Change the module, then run `node bin/harness.mjs update .`. The statuses in "What has been exercised" change only once a piece has been watched working here.

## License and security

MIT, see `LICENSE`. To report a vulnerability in a piece of the kit, see `SECURITY.md`.
