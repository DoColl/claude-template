# OpenSpec workflow

**Rule (CLAUDE.md § Key conventions):** `openspec/specs/<area>/<capability>/spec.md` is the current behaviour; `openspec/changes/<id>/` is work in flight. A change goes explore → propose → apply → sync → archive, and **a change is closed only once its deltas are in the specs and it is archived**. The command and skill files OpenSpec generates are never hand-edited.

## Status

Written against OpenSpec CLI 1.10.0, and checked against that version in one installed project:

- `openspec init --tools claude` is the non-interactive way to initialise; with the default `core` profile it generates six commands and six skills.
- `openspec validate --all --strict --no-interactive`, the command OS-1 runs: on a project with no spec and no change it prints "No items found to validate" and exits 0; a change that was only scaffolded fails; a valid change passes, and so does a spec alone.

Checked since, with the same version, in a scratch project rendered from the kit:

- OS-1 itself on a change with no delta: red while the change only says so in its proposal, green once its `.openspec.yaml` has `skip_specs: true`; the change then archives without `--skip-specs`, and the CLI refuses that line on a change that has delta specs.
- A hand edit of a generated command survives a plain `openspec update` and is undone by `openspec update --force`.

Not exercised: OS-1 on a CI runner (the kit installs no CLI there, so the guard skips), and any later version of the CLI — the generated commands change with it.

## Why

A plan written before the work and never touched again drifts from what was built: the status stays "planned" after the feature shipped, the acceptance criteria describe a design that changed twice. The next reader — a person or a session — then trusts a document that is wrong.

OpenSpec separates two things that plans mix. The **specs** describe what the system does now, as requirements with scenarios. A **change** describes what is about to be different: a proposal, a design, tasks, and the deltas to the specs. **Syncing** a change merges its deltas into the specs. That merge is the step that keeps the description of the system true, which is why it cannot be skipped — and archiving does not guarantee it: the CLI can archive a change without updating the specs.

## Details

- **Specs**: `openspec/specs/<area>/<capability>/spec.md` — `### Requirement:` blocks, each with `#### Scenario:` entries in WHEN / THEN form. One capability per file; areas group them.
- **Changes**: `openspec/changes/<id>/` with `proposal.md` (why, what changes), `design.md` (the working draft of the technical choices), `tasks.md` (grouped, checkable), and delta specs under `specs/`. Archived changes move to `openspec/changes/archive/`.
- **Workflow**: six commands with the default profile. `/opsx:explore` to think a problem through; `/opsx:propose` to create the change with its artefacts; `/opsx:apply` to implement the tasks; `/opsx:sync` to merge the change's delta specs into `openspec/specs/`; `/opsx:archive` once the work is merged; `/opsx:update` to revise a change's existing artefacts and keep them coherent with one another.
- **Sync, then archive.** Archiving moves the change to `openspec/changes/archive/`. It offers to sync first, and lets you decline (`openspec archive --skip-specs` on the command line): the change is then filed away with its deltas never applied, and the specs describe the system as it was. Skip the sync only for a change that has no delta — tooling, infrastructure, documentation — and declare it with `skip_specs: true` in the change's `.openspec.yaml`: without that line `openspec validate` rejects a change with no delta, so OS-1 stays red while it is in flight. With it, the change has nothing to sync and archives without `--skip-specs`.
- **`design.md` is a draft.** When a choice in it is durable — a technology, a pattern, a trade-off — it becomes a numbered ADR in `docs/adr/`, and `design.md` points at it.
- **Generated files**: `.claude/commands/opsx/**` and `.claude/skills/openspec-*/**` come from `openspec init` and `openspec update`. They are committed so that a clone has the commands; they are never edited by hand: `openspec update` rewrites them once they come from another CLI version or the profile changed, `openspec update --force` at any time, and either silently undoes the edit.
- **With the agents module**: a task group in `tasks.md` is the unit handed to `implementer`; add the validation command to the Bash guard's verification config so `verifier` can run it.
- **Behavioural conventions** in `docs/conventions/` are the natural source for the first capability specs. When a spec absorbs one, the convention file can go — after everything that names it has been repointed: its `CLAUDE.md` bullet (CM-2 fails on a path that no longer exists), its row in `docs/conventions/README.md`, and any other list of the project that holds the path (a table of files merged by hand, a guard, a review skill). Where the page is referenced from places you would rather not touch, keep it as a short page that states the rule in one line and points at the spec.
- **Pin the CLI.** Install a fixed version, in CI as on laptops, and bump it deliberately: the generated commands change with it.

## Checks

- **OS-1** (`scripts/guards.d/46-openspec.sh`) — `openspec validate --all --strict --no-interactive` passes. Skipped when the CLI is not installed or when there is no spec and no change yet.

Neither the sync nor the archive has a mechanical check. A change left open after its work merged shows up as a directory under `openspec/changes/` that nobody is working on; a change archived without its sync shows up nowhere, except as specs that no longer match the code.

## History

- Installed with the kit.
- After the first installation in a project, with CLI 1.10.0: the page named four of the six generated commands, said that archiving merges the deltas (it can be done without) and that `openspec update` regenerates the generated files (only once they are out of date, or with `--force`), asked for an absorbed convention page to be deleted without a word on what else names it, and said the validation command had never been run on an empty project. All corrected from what was observed.
