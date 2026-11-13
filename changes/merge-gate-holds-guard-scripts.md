bump: patch

- `auto-merge`: `CLAUDE_GATE_RE` also holds the scripts that the guards of `weekly-digest`, `node-audit` and `parallel-sessions` run, and what they read: `scripts/weekly-digest.mjs`, its test and its settings (`scripts/weekly-digest.config.mjs`), which the scheduled digest also runs with a token that writes issues; `scripts/audit-gate.mjs`, its test and `scripts/audit-allowlist.json`, the accepted advisories; `scripts/parallel-sessions.sh`. A pull request that changed one of them merged on green CI, judged by a CI that ran the changed file — for the allowlist, a derogation added with nobody reading it. AM-1 has a row for each, and neighbours that keep merging; the weekly digest's built-in copy of the pattern follows.
- A test of the kit holds every file a module ships under `scripts/` to the pattern, so that a new module cannot leave one out.

By hand: nothing. A project that had added some of these paths to `PROJECT_GATE_RE` may take them out again (`update . --set PROJECT_GATE_RE=<the rest>`); a path held by both patterns is held once.
