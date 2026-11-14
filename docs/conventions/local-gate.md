# The local gate and its guards

**Rule (CLAUDE.md § Key conventions):** a rule that matters is a check. Every fixed bug or review finding gets an ID, a line in `SECURITY_REVIEW.md` and a guard in `scripts/guards.d/`; one gate runs them, before a push and in CI where a workflow calls it.

## Why

A rule written as a sentence is followed until the day it is not, and nothing says which day that was. A model reading instructions is no different from a person here: wording does not enforce anything. What holds is a check that fails loudly, names the rule by its ID and points at its story.

The second half of the rule is that the check runs in two places from one source. A gate that exists only in CI is discovered after the push; a gate that exists only on a laptop is skipped. `scripts/security-checks.sh` is the single entry point: run it before pushing, and have CI call the very same script.

That second place is not installed with this page. The gate is local until a CI workflow runs it (the kit's `ci-security` module ships one). Until then nothing checks a push that skipped the local run: read every sentence here about CI as "once a workflow calls the gate".

## Details

- **Entry point**: `./scripts/security-checks.sh` runs every `scripts/guards.d/NN-name.sh` in order and fails if any guard fails. `--offline` exports `HARNESS_OFFLINE=true`; guards that need the network skip themselves.
- **Guard contract**: a bash script; exit `0` = pass, `77` = skipped (tool missing, offline), anything else = fail. Source `_lib.sh` for `ok`, `fail`, `note`, `skip`, `finish`. A guard prints one line per check, starting with the check's ID.
- **A self-test fails whatever started the gate**: the gate clears `NODE_TEST_CONTEXT` for every guard, and `_lib.sh` again for a guard started on its own. A Node test run sets it for every process it starts, and a `node --test` that inherits it exits 0 whatever its tests do (Node 20.12 and later; an older one runs them but prints their results serialized) — so a project whose own tests call the gate, to watch a guard go red, would otherwise see every self-test pass. The same variable is how Node stops a test run that starts itself again: a guard that runs tests which start the gate would now loop, so the gate refuses to run more than three levels deep (`HARNESS_GATE_DEPTH`).
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

The catalogue only grows if someone turns a mistake into a finding. `.claude/skills/retro/` is a skill run at the end of a session that changed files, hit a red gate or was corrected (`CLAUDE.md` § Working rules), in a closing form that works from what the session already holds and stops at five candidates; and by hand, in full, on a session the user names. It reads the session's evidence and what the project already has, lists the incidents, and gives each one destination, cheapest to enforce first: an issue for the kit when the cause is in a file the kit owns, a check (a finding with its ID, its row and its guard), a review rule, a pointer, an access to set up, an instruction to prune, or no action with its reason. It proposes; it changes nothing until the user picks.

**What concerns the kit goes to the kit.** A fault in a kit-owned file is not fixed in the project: the next update would bring it back. The skill drafts an issue for the kit's repository (`DoColl/claude-template`, a value of the installation: `update . --set KIT_REPOSITORY=<owner>/<name>` for a fork), in general terms — no name, code, path or data of this project — and posts it only once the user has read it and said yes. A session that cannot reach that repository leaves the text ready to paste. An unattended session runs no retrospective and posts nothing.

The rule that starts it is a sentence in `CLAUDE.md`, not a check: nothing fails when a session skips it, and its cost is paid at the end of every session that qualifies. Prune the sentence if its proposals stop being used.

It was first declared `disable-model-invocation: true`, run by hand only; that line went when the closing form was added, since a session must be able to start it.

Status: written for the kit. Its closing form ran once, at the end of a session on the kit itself, and the issues it drafted for the kit were posted after the user's yes. Not run in an installed project that cannot reach the kit's repository, and the full form has not run: treat those first runs as its test.

## Sources

- [mattpocock/skills](https://github.com/mattpocock/skills), MIT licence, read at commit `5863806` (2026-11-12): the idea of a retrospective that proposes changes to an agent's environment (`skills/engineering/retro`), its split between a mechanical violation, which gets a deterministic check, and a judgement call, which gets a written rule, and the retrospective task of its software-factory notes (`skills/in-progress/software-factory/EXAMPLE-TASKS.md`). The skill's text, its order of destinations and its tie to this catalogue are the kit's own; no text was copied.

## Checks

The gate checks itself only in the obvious way: with no guard to run, it fails rather than report success.

- **HD-1** (advisory) — the kit-owned files that differ from the hash recorded in `.claude/harness.json` (`scripts/guards.d/91-harness-drift.sh`).

## History

- Installed with the kit.
- The `/retro` skill added, to turn a session's mistakes into findings.
- `/retro` gets a closing form, run at the end of a session, and a destination for what concerns the kit: a drafted issue for the kit's repository, posted on the user's yes.
- The gate and `_lib.sh` clear `NODE_TEST_CONTEXT`, and the gate stops at three levels of itself. With the gate started from a Node test run, the self-tests that four guards run with `node --test` reported `ok` while failing; the kit's own tests had met it and worked around it on their side only.
