# The local gate and its guards

**Rule (CLAUDE.md § Key conventions):** a rule that matters is a check. Every fixed bug or review finding gets an ID, a line in `SECURITY_REVIEW.md` and a guard in `scripts/guards.d/`; the gate and CI run the same guards.

## Why

A rule written as a sentence is followed until the day it is not, and nothing says which day that was. A model reading instructions is no different from a person here: wording does not enforce anything. What holds is a check that fails loudly, names the rule by its ID and points at its story.

The second half of the rule is that the check runs in two places from one source. A gate that exists only in CI is discovered after the push; a gate that exists only on a laptop is skipped. `scripts/security-checks.sh` is the single entry point: run it before pushing, and CI's enforcing job calls the very same script.

## Details

- **Entry point**: `./scripts/security-checks.sh` runs every `scripts/guards.d/NN-name.sh` in order and fails if any guard fails. `--offline` exports `HARNESS_OFFLINE=true`; guards that need the network skip themselves.
- **Guard contract**: a bash script; exit `0` = pass, `77` = skipped (tool missing, offline), anything else = fail. Source `_lib.sh` for `ok`, `fail`, `note`, `skip`, `finish`. A guard prints one line per check, starting with the check's ID.
- **Skipping is not passing**: a guard whose tool is missing skips locally but must fail in CI (`$CI` set) when the check is mandatory — otherwise a broken runner image turns the gate green.
- **Numbering**: `10-` instruction files, `20-49` harness modules, `50-project.sh` the project's own regression checks, `90-` advisory notes. A new family of project checks is a new file (`60-<name>.sh`).
- **IDs**: stable and short (`CM-1`, `AG-2`, `H3`). The same ID appears in the guard's output, in `SECURITY_REVIEW.md` and in the convention file, so a red line leads straight to the reason.
- **Cheap on purpose**: guards are grep-level or a small script. They do not re-test the fix (that is the regression test's job); they catch the fix being removed, renamed away or bypassed.
- **`50-project.sh` is yours**: the kit never overwrites it. The other guards belong to the kit and are refreshed by its `update` command as long as you have not edited them.

## Checks

The gate checks itself only in the obvious way: with no guard to run, it fails rather than report success.

## History

- Installed with the kit.
