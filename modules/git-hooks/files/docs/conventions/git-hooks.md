# Git hooks

**Rule (CLAUDE.md § Key conventions):** `.githooks/` holds the two local checks — `pre-commit` scans the staged changes for secrets, `pre-push` runs the gate offline. Each clone opts in with `git config core.hooksPath .githooks`. `--no-verify` is never passed to get past a failure: the failure is fixed or reported.

## Why

A reminder to "run the checks before pushing" is a sentence, and sentences are skipped — by people in a hurry and by models alike. A hook that git itself runs is not a matter of memory.

The two hooks sit where each failure is cheapest to fix. A secret is caught before it enters the history, when removing it is an edit rather than a history rewrite and a key rotation. A red gate is caught before the push, when no reviewer or CI minute has been spent.

## Details

- **Opt-in per clone.** Git does not run hooks from a cloned repository by default, on purpose. `git config core.hooksPath .githooks` is the one manual step. A worktree created with `git worktree add` shares the setting of its repository; a fresh clone needs the command again.
- **`pre-commit`** runs `gitleaks git --config .gitleaks.toml --staged --redact`, with the repository's `.gitleaksignore`. The config is named because gitleaks would otherwise read a `.gitleaks.json` first, one that a commit could add; without `.gitleaks.toml` the hook fails. It refuses to run without gitleaks rather than pass silently.
- **`pre-push`** runs `./scripts/security-checks.sh --offline`. It checks the working tree, not the exact commits being pushed: with uncommitted changes or a push of another branch the two differ, and only a CI workflow that runs the gate checks the pushed commit itself. A push that only deletes refs skips the gate.
- **`--no-verify`** skips both hooks, and is not the answer to a red one. A hook that fails names something to fix; if it cannot be fixed now, it is reported, not bypassed. A session never passes the flag. A person who passes it knowingly — a hook broken by its own tool, not by the change — should know what then stands behind the push: a CI workflow running the same gate and the same secret scan, if the project has one, and nothing at all if it does not.
- **The hooks are the early warning, not the gate of record.** They are opt-in per clone and skippable, so they cannot be what a project relies on. What cannot be skipped is a CI workflow that runs the gate and scans the pushed commits (the kit's `ci-security` module ships one). Without it, these hooks are the only automatic check there is: install the workflow before treating a push as checked.
- **Model sessions** go through the same hooks as people: a session that commits or pushes through git triggers them. Do not add an instruction telling a session to pass `--no-verify`.

## Checks

None of its own: the hooks are the checks. If a gate run in CI goes red on something `pre-push` should have caught, the first question is whether the clone opted in.

## History

- Installed with the kit.
