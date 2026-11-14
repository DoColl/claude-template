# npm audit gate

**Rule (CLAUDE.md § Key conventions):** `scripts/audit-gate.mjs` fails the gate on any advisory at high or above in a workspace's lockfile (NA-1), dev dependencies included. An advisory with no reachable fix is accepted per package and advisory id in `scripts/audit-allowlist.json`, with a reason and a `review_by` date — never a whole package or a severity.

## Why

A bare `npm audit --audit-level=high` leaves two options the day an advisory has no patched release reachable without breaking the build: block the pipeline until upstream moves, or lower the threshold and lose coverage of everything else at that severity. Both are bad, and under pressure the second one wins and stays.

The gate keeps the threshold and narrows the exception instead: one advisory id, for one package, until one date, at the severity it had when it was accepted. Everything else still fails.

It also refuses to mistake a broken audit for a clean one. npm reports its own failures — no lockfile, registry unreachable, rate limit — as well-formed JSON with no findings in it; read naively, an infrastructure hiccup turns the only dependency gate green.

## Details

- **What runs**: `npm audit --json` in each workspace, from `package-lock.json` through the registry. `node_modules` is never consulted, so there is no install step. The scope is pinned to prod, dev, optional and peer dependencies: npm silently drops the dev tree when `NODE_ENV=production`, and that tree is where most findings are; a type named on the command line wins over an `omit` in a workspace's `.npmrc`. That file still chooses the registry the audit asks, and a registry that answers nothing reads as a clean audit: review a change to a `.npmrc` like a change to the list of derogations.
- **Workspaces**: the directories on the `workspaces=` line of `scripts/guards.d/35-node-audit.sh`, set when the module was installed (`NODE_WORKSPACES`). A listed directory without a `package-lock.json` is noted and passed over; one that does not exist fails.
- **Threshold**: high and critical. Only root advisories count (an entry that merely names the parent that dragged a package in would double-count). An unknown severity ranks as critical: a level npm introduces later must surface, not vanish.
- **Fail closed**: an `error` or `message` in the report, a report without a `vulnerabilities` key, output that is not JSON, or counters announcing high or critical findings that could not be parsed all end the run with exit code 2. So does a malformed allowlist.
- **Network**: the audit needs the registry. `./scripts/security-checks.sh --offline` skips NA-1 (the pre-push hook therefore does not run it): CI, where the gate runs without `--offline`, is where it blocks.

### The allowlist

`scripts/audit-allowlist.json` › `allow`, one object per derogation:

| Field | Meaning |
|---|---|
| `package` | the package as `npm audit` reports it |
| `advisory` | the advisory id — the last segment of its URL (`GHSA-…`) |
| `severity` | the severity accepted; a later re-rating above it re-opens the gate |
| `review_by` | `YYYY-MM-DD`; past that date the entry no longer applies |
| `reason` | why it cannot be fixed **and** why it is not reachable |
| `workspace` | optional: the one directory it applies to, spelled as in the guard |

- An entry is a **derogation** under the findings policy: it needs the same justification as any finding left open, and the owner's decision.
- An entry missing a field, or scoped to a workspace that is not in the guard's list, refuses the whole run — a derogation with no reason or no expiry is a silent exception, and a typo in `workspace` would otherwise never apply and never be noticed.
- Without `workspace`, an entry applies to every lockfile. With it, the other workspaces neither honour it nor report it as stale.
- A stale entry (the advisory is no longer reported) is printed on every run until it is pruned. An allowlist nobody prunes stops being read.

### Remediating

Fix the advisory with a targeted update of the one package, then read the lockfile diff and refuse any change outside the advisory's package. Never a bare `npm audit fix`: it resolves an advisory by whatever change satisfies the resolver, downgrades of unrelated packages included.

An override (or resolution) that forces a patched version is a pin nobody updates: Dependabot does not see it, and will not say when it is itself vulnerable. Note each one where the periodic audit will find it.

Some advisories are fixed by a backport that the advisory's version range still covers; `npm audit` then cannot tell a fixed lockfile from a regressed one. That case needs its own guard on the lockfile (a minimum version per package) in `scripts/guards.d/50-project.sh`.

### Other package managers

The gate reads npm's report format and needs `package-lock.json`. A project on another package manager needs its own guard; the shape to keep is the same — a threshold that does not move, exceptions that name one advisory and expire, and a run that fails when the tool does.

## Checks

- **NA-1** — the audit, per workspace (`scripts/guards.d/35-node-audit.sh`).
- **NA-2** — `node --test scripts/audit-gate.test.mjs`: the gate against canned reports, with a fake `npm`. Offline, run on every gate.

## History

- Installed with the kit.
