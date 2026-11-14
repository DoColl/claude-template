bump: patch

- `core`: a self-test that a guard runs with `node --test` (AG-1, PL-1, NA-2, WD-1, and any guard of the project's) fails the gate again when the gate is started from inside a Node test run, such as a project's own tests that call it to watch a guard go red. Such a run sets `NODE_TEST_CONTEXT` for what it starts, and from Node 20.12 a `node --test` that inherits it exits 0 whatever its tests do. `scripts/security-checks.sh` now clears it for every guard, and `scripts/guards.d/_lib.sh` again for a guard started on its own.
- The same variable is how Node stops a test run that starts itself again. Without it, a guard that runs tests which start the gate would loop: the gate now refuses to run more than three levels deep (`HARNESS_GATE_DEPTH`).
- The kit's end-to-end tests start the gate with the variable set, so a red self-test is seen red there whatever runs them, with a guard that sources `_lib.sh` and one that does not.

By hand: nothing.
