# CLAUDE.md

<!-- harness:budget 12000 -->

Guidance for Claude Code when working **on the kit itself**. (The `CLAUDE.md` a project receives is `modules/core/files/CLAUDE.md`.)

## What this repository is

`claude-template` is a modular Claude Code harness: instruction files, sub-agents, hooks, a local gate and CI workflows, installed into a project module by module by `bin/harness.mjs`. Read `README.md` for the idea and `docs/module-authoring.md` for the contract every module follows.

- `bin/harness.mjs` — the CLI (`list`, `init`, `add`, `status`, `update`). `bin/release.mjs` — cuts a release from the changelog fragments in `changes/`. `lib/` — their logic: `kit.mjs` (manifests, dependency resolution), `render.mjs` (placeholders, slots, appended blocks), `install.mjs` (plan, apply, manifest), `release.mjs` (fragments, next version, changelog entry).
- `modules/<id>/` — `module.json`, `files/` (copied as is), `fragments/` (inserted at slots of seed files), `append/`.
- `test/` — `engine.test.mjs` (pure functions, the static rules on every module, the changelog fragments), `install.test.mjs` (installs every module into a scratch project and runs its gate; cuts a release in a copy of the kit).
- `skills/harness-init/` — a skill to run the installer from a Claude Code session.

## Commands

```bash
node --test test/*.test.mjs                     # everything; needs git and bash, no network
node bin/harness.mjs list             # the modules
node bin/harness.mjs init /tmp/try --modules <id>   # then, in /tmp/try: git init -q && git add -A && ./scripts/security-checks.sh --offline
pipx run --spec 'zizmor==1.31.1' zizmor --offline <rendered project>/.github/workflows/
node bin/release.mjs --dry-run        # the next release, from changes/; without --dry-run it writes it
```

## Rules

- **The contract is `docs/module-authoring.md`**; `test/engine.test.mjs` enforces most of it. A new rule for modules is a test there, not a sentence here.
- **Every module passes alone.** Installed with only what it requires, its guard is green and nothing it writes mentions a module that is not installed. Cross-module text goes through fragments and slots.
- **Seeds are the project's.** A file listed in `seed` is created once and never overwritten; fragments may only target seeds. Machinery stays kit-owned so `update` can refresh it.
- **No stack assumption in `core`, `agents`, `git-hooks`, `security-review`.** What only the project knows is a `TODO(harness)` comment or a config entry, never a guess. Stack-specific pieces are their own module (`node-audit`).
- **Pins are copied, never invented**: an action SHA, a tool version or a checksum comes from a reviewed source. Workflows follow the rules in `docs/module-authoring.md` § Workflows and zizmor reports nothing on them.
- **Strangers read this.** No names of people, organisations or infrastructure from the project a piece came from, no issue numbers or incident dates; state reasons in general terms. English only.
- **Credit public sources.** A piece drawn from a public source (a skill collection, a vendor's documentation or code) names it on its convention page — repository or URL, licence, the commit or date read, what was taken — and in `README.md` § Sources and credits. Copied text keeps its licence notice.
- **Say what was exercised.** A module's convention page states whether the piece has run in production, is unit-tested only, or has never run live. Do not upgrade that statement without having run it.
- **Security-sensitive pieces** — the Bash allowlist (`modules/agents/files/.claude/hooks/`), `auto-merge`, `claude-ci`, `claude-review`: when a generalisation would loosen a condition, keep the stricter form. Every allowlist change comes with rows in its test table (the allow, and the nearby form that must stay blocked).
- **A changelog fragment, never a version.** A pull request adds `changes/<slug>.md`: `bump: patch|minor|major`, a blank line, the lines of its entry, then a paragraph that starts with `By hand:` (`By hand: nothing.` when there is nothing to do). It leaves `kit.json`, `package.json`, the version in `.claude/harness.json` and `CHANGELOG.md` alone; CI requires a fragment when `modules/`, `lib/` or `bin/` change. A release is `node bin/release.mjs` in a pull request of its own (`README.md` § Working on the kit).
- The installer and the release command have no dependency beyond Node (>= 20). Keep it that way.

## The kit's own harness

The kit installs part of itself at its root (`.claude/harness.json`): `core`, `ci-security`, `weekly-digest`, `ready-on-green`, `parallel-sessions` and `eco-design`, so that those guards, workflows and scripts run somewhere before a project trusts them. The root copies are installed files, never edited in place: change the module, then run `node bin/harness.mjs update .` — a test fails while a root copy is behind its module. `auto-merge` is not installed here: it needs a ruleset on the default branch, which is not enforced on this repository as it stands (the module's policy page, § Setting it up). Every pull request is merged by hand; `ready-on-green` only lifts its draft once CI is green.

- **Close with a retrospective**: before the final summary of a session that changed files, hit a red gate or was corrected, run `/retro` in its closing form. Here the kit is the project: what it finds in a module is an issue on this repository, drafted, then posted once the user has read it. → `docs/conventions/local-gate.md`
- **The gate**: `./scripts/security-checks.sh` runs every guard in `scripts/guards.d/`, here and in CI. → `docs/conventions/local-gate.md`
- **This file is budgeted**: what a session loads of it stays under its `harness:budget` line (CM-1), and every `docs/` path it names exists (CM-2). A rule about some files only is a path-scoped file in `.claude/rules/`, as the GitHub Actions and Dependabot rules are. → `docs/conventions/claude-md.md`
- **Weekly digest**: `weekly-digest.yml` opens one `weekly-digest` issue a week, assigned to the repository owner, listing what waits on a human. Every `schedule:` workflow is watched automatically; it copies **titles only**, never PR or issue bodies. A dated follow-up is an issue labelled `deadline` with a `Due: YYYY-MM-DD` line, never a Markdown list. → `docs/conventions/weekly-digest.md`
- **Parallel sessions**: several sessions work here. Run `./scripts/parallel-sessions.sh` when you start and before you push. Before a pull request, rebase on `origin/main` (merge it if the branch is pushed). When another branch holds the same files, the user orders the merges. → `docs/conventions/parallel-sessions.md`
- **Eco-design**: `eco-design.yml` audits every pull request with green-claude at the commit pinned in `scripts/eco-design.config.json` (ED-1..3). A finding is a candidate: fix it, or record it in `.green-claude/decisions.md` with its reason, reviewed like a derogation. The rules never outrank this file, security or the request. → `docs/conventions/eco-design.md`
<!-- harness:rows conventions -->

`.github/workflows/security.yml` has two tiers. **Enforcing** (blocks merges; every run, including the one CI calls first): gitleaks over the full history, then `./scripts/security-checks.sh` — the same gate as on a laptop. **Advisory** (log-only; weekly cron, manual dispatch and docs-only pushes): Semgrep, Trivy, a Syft SBOM. Scanner binaries are pinned releases verified by sha256 (`scripts/fetch-pinned-release.sh`); zizmor is pinned to an exact PyPI version, without a hash. Never `curl … | sh`, never a bump without the procedure. → `docs/conventions/security-workflow.md`

<!-- harness:slot security-workflow -->
## Before pushing

`node --test test/*.test.mjs` and `./scripts/security-checks.sh`, then zizmor on a rendered project and on `.github/workflows/`. A change to a guard or a workflow is also tried by hand in a scratch project: break the thing the guard protects and watch it go red.
