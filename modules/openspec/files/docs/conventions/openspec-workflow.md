# OpenSpec workflow

**Rule (CLAUDE.md § Key conventions):** `openspec/specs/<area>/<capability>/spec.md` is the current behaviour; `openspec/changes/<id>/` is work in flight. A change goes explore → propose → apply → archive, and **archiving is not optional**. The command and skill files OpenSpec generates are never hand-edited.

## Status

The guard runs the validation command this convention was written against (OpenSpec CLI 1.10.0). The kit's authors have not run it against an empty project: if `openspec validate` behaves differently on yours, adjust `scripts/guards.d/46-openspec.sh` and say so in the History below.

## Why

A plan written before the work and never touched again drifts from what was built: the status stays "planned" after the feature shipped, the acceptance criteria describe a design that changed twice. The next reader — a person or a session — then trusts a document that is wrong.

OpenSpec separates two things that plans mix. The **specs** describe what the system does now, as requirements with scenarios. A **change** describes what is about to be different: a proposal, a design, tasks, and the deltas to the specs. Archiving a change merges its deltas into the specs. That merge is the step that keeps the description of the system true, which is why it cannot be skipped.

## Details

- **Specs**: `openspec/specs/<area>/<capability>/spec.md` — `### Requirement:` blocks, each with `#### Scenario:` entries in WHEN / THEN form. One capability per file; areas group them.
- **Changes**: `openspec/changes/<id>/` with `proposal.md` (why, what changes), `design.md` (the working draft of the technical choices), `tasks.md` (grouped, checkable), and delta specs under `specs/`. Archived changes move to `openspec/changes/archive/`.
- **Workflow**: `/opsx:explore` to think a problem through, `/opsx:propose` to create the change with its artefacts, `/opsx:apply` to implement the tasks, `/opsx:archive` once the work is merged.
- **`design.md` is a draft.** When a choice in it is durable — a technology, a pattern, a trade-off — it becomes a numbered ADR in `docs/adr/`, and `design.md` points at it.
- **Generated files**: `.claude/commands/opsx/**` and `.claude/skills/openspec-*/**` come from `openspec init` and `openspec update`. They are committed so that a clone has the commands; they are never edited by hand, because the next `openspec update` would silently undo the edit.
- **With the agents module**: a task group in `tasks.md` is the unit handed to `implementer`; add the validation command to the Bash guard's verification config so `verifier` can run it.
- **Behavioural conventions** in `docs/conventions/` are the natural source for the first capability specs. When a spec absorbs one, delete the convention file and repoint its `CLAUDE.md` bullet at the spec.
- **Pin the CLI.** Install a fixed version, in CI as on laptops, and bump it deliberately: the generated commands change with it.

## Checks

- **OS-1** (`scripts/guards.d/46-openspec.sh`) — `openspec validate --all --strict --no-interactive` passes. Skipped when the CLI is not installed or when there is no spec and no change yet.

Archiving discipline has no mechanical check: a change left open after its work merged shows up as a directory under `openspec/changes/` that nobody is working on.

## History

- Installed with the kit.
