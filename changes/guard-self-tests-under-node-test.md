bump: patch

- `core`: a self-test that a guard runs with `node --test` (AG-1, PL-1, NA-2, WD-1) fails the gate again when the gate is started from inside a Node test run, such as a project's own tests that call it to watch a guard go red. Such a run sets `NODE_TEST_CONTEXT` for what it starts, and a `node --test` that inherits it exits 0 whatever its tests do. `scripts/guards.d/_lib.sh`, which every guard sources, now clears it. The kit's end-to-end tests start the gate with the variable set, so a red self-test is seen red there whatever runs them.

By hand: nothing.
