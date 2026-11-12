# The local gate and its guards

**Rule (CLAUDE.md § Key conventions):** a rule that matters is a check. Every fixed bug or review finding gets an ID, a line in `SECURITY_REVIEW.md` and a guard in `scripts/guards.d/`; one gate runs them, before a push and in CI where a workflow calls it.

## Why

A rule written as a sentence is followed until the day it is not, and nothing says which day that was. A model reading instructions is no different from a person here: wording does not enforce anything. What holds is a check that fails loudly, names the rule by its ID and points at its story.

The second half of the rule is that the check runs in two places from one source. A gate that exists only in CI is discovered after the push; a gate that exists only on a laptop is skipped. `scripts/security-checks.sh` is the single entry point: run it before pushing, and have CI call the very same script.

That second place is not installed with this page. The gate is local until a CI workflow runs it (the kit's `ci-security` module ships one). Until then nothing checks a push that skipped the local run: read every sentence here about CI as "once a workflow calls the gate".

## Details

- **Entry point**: `./scripts/security-checks.sh` runs every `scripts/guards.d/NN-name.sh` in order and fails if any guard fails. `--offline` exports `HARNESS_OFFLINE=true`; guards that need the network skip themselves.
- **Guard contract**: a bash script; exit `0` = pass, `77` = skipped (tool missing, offline), anything else = fail. Source `_lib.sh` for `ok`, `fail`, `note`, `skip`, `finish`. A guard prints one line per check, starting with the check's ID.
- **Skipping is not passing**: a guard whose tool is missing skips locally but must fail in CI (`$CI` set) when the check is mandatory — otherwise a broken runner image turns the gate green.
- **Numbering**: `10-` instruction files, `20-49` harness modules, `50-project.sh` the project's own regression checks, `90-99` advisory notes. A new family of project checks is a new file (`60-<name>.sh`).
- **IDs**: stable and short (`CM-1`, `AG-2`, `H3`). The same ID appears in the guard's output, in `SECURITY_REVIEW.md` and in the convention file, so a red line leads straight to the reason.
- **Cheap on purpose**: guards are grep-level or a small script. They do not re-test the fix (that is the regression test's job); they catch the fix being removed, renamed away or bypassed.
- **`50-project.sh` is yours**: the kit never overwrites it. The other guards belong to the kit and are refreshed by its `update` command as long as you have not edited them.

### Kit files and their hashes

`.claude/harness.json` records what the installer wrote. A kit-owned file (a guard, a hook, a workflow, a convention page) is recorded with the sha256 of its content at installation; a seed (`CLAUDE.md`, an index, a config: yours to fill) is recorded with `"seed": true` and no hash.

`scripts/guards.d/91-harness-drift.sh` (HD-1) hashes every kit-owned file and lists the ones that no longer match, or are gone. It needs neither the kit's checkout nor Node, and it never fails: editing a kit file is allowed. What it gives is the line between what was reviewed where:

- a kit file **identical to its hash** is what the kit shipped; it was reviewed in the kit, and a review in the project need not read it again;
- a kit file **HD-1 lists**, a **seed** and every file of the project's own are reviewed in the project.

The manifest is the reference of that comparison, so HD-1 says nothing about a change that writes the manifest: an installation or an update of the kit. There the reference is the kit's checkout, which whoever installs has at hand: `node <kit>/bin/harness.mjs update . --dry-run` compares each file with what that kit renders. It must print `nothing to write`, with no `left alone`, `would be updated` or `CONFLICTS` list; name the kit commit installed from in the pull request.

### Feeding the catalogue: `/retro`

The catalogue only grows if someone turns a mistake into a finding. `.claude/skills/retro/` is a skill run by hand after a session that made a mistake, needed a correction or took far longer than it should. It reads the session's evidence and what the project already has, lists the incidents, and gives each one destination, cheapest to enforce first: a check (a finding with its ID, its row and its guard), a review rule, a pointer, an access to set up, an instruction to prune, or no action with its reason. It proposes; it changes nothing until the user picks.

It is declared `disable-model-invocation: true`: no session starts it on its own, and its description costs no context until it is called.

Status: written for the kit, never run live. Treat its first runs as its test.

## Checks

The gate checks itself only in the obvious way: with no guard to run, it fails rather than report success.

- **HD-1** (advisory) — the kit-owned files that differ from the hash recorded in `.claude/harness.json` (`scripts/guards.d/91-harness-drift.sh`).

## History

- Installed with the kit.
- The `/retro` skill added, to turn a session's mistakes into findings.
