bump: patch

- `docs/module-authoring.md` § Workflows gains a rule: a step that prints text it does not control turns workflow commands off around it (`::stop-commands::<token>`, a random token per run, the resume on the failure path and before the step's own annotation). A line that starts with `::` in a scanner report or a title could otherwise forge or hide an annotation.
- `ci-security`: the Semgrep and Trivy steps of `security.yml` now do it, and their warning no longer hangs on the scanner's `||`. `weekly-digest`: the digest it prints to the log (titles from outside) does too. The other steps were read and cleared: their prints are single-line values that never start a line, or fixed text. A test in `test/engine.test.mjs` names the steps that must do it. Not run on a live runner.

By hand: nothing.
