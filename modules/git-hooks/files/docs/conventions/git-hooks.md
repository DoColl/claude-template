# Git hooks

**Rule (CLAUDE.md § Key conventions):** `.githooks/` holds the two local checks — `pre-commit` scans the staged changes for secrets, `pre-push` runs the gate offline. Each clone opts in with `git config core.hooksPath .githooks`.

## Why

A reminder to "run the checks before pushing" is a sentence, and sentences are skipped — by people in a hurry and by models alike. A hook that git itself runs is not a matter of memory.

The two hooks sit where each failure is cheapest to fix. A secret is caught before it enters the history, when removing it is an edit rather than a history rewrite and a key rotation. A red gate is caught before the push, when no reviewer or CI minute has been spent.

## Details

- **Opt-in per clone.** Git does not run hooks from a cloned repository by default, on purpose. `git config core.hooksPath .githooks` is the one manual step. A worktree created with `git worktree add` shares the setting of its repository; a fresh clone needs the command again.
- **`pre-commit`** runs `gitleaks git --staged --redact`, with the repository's `.gitleaks.toml` and `.gitleaksignore`. It refuses to run without gitleaks rather than pass silently.
- **`pre-push`** runs `./scripts/security-checks.sh --offline`. It checks the working tree, not the exact commits being pushed: with uncommitted changes or a push of another branch the two differ, and CI is the check on the pushed commit. A push that only deletes refs skips the gate.
- **`--no-verify`** skips both hooks. That is acceptable only because CI runs the same gate and the same secret scan on what was pushed: the hooks are the early warning, CI is the gate.
- **Model sessions** go through the same hooks as people: a session that commits or pushes through git triggers them. Do not add an instruction telling a session to pass `--no-verify`.

## Checks

None of its own: the hooks are the checks. If the CI gate goes red on something `pre-push` should have caught, the first question is whether the clone opted in.

## History

- Installed with the kit.
