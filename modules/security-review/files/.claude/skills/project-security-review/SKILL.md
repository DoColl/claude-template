---
name: project-security-review
description: >-
  Project-aware security review. Run once BEFORE pushing a tier 3 diff: one
  that touches the sensitive areas CLAUDE.md lists under "Before pushing".
  Layers this project's
  findings catalogue (SECURITY_REVIEW*.md) and its invariants on top of the
  generic /security-review, and names the scanner to run for the area touched.
---

# Project security review

The generic `/security-review` is a floor, not full coverage: it does not know this project's invariants or what has already gone wrong here. This skill is the project layer on top of it. The `security-reviewer` agent preloads it.

## When to run

A tier 3 diff: one touching the areas below — the same list as CLAUDE.md § "Before pushing"; keep the two identical. Tiers 1 and 2 (documentation, instruction files, harness scripts, hooks and workflows) do not need this skill run on its own: the `security-reviewer` agent, which covers tier 2, already has it in context.

TODO(harness): list the sensitive areas with their paths — authentication and authorization; writes on user data; external I/O (controllers, exports, integrations); configuration (environment variables, container files).

## Step 1 — The findings catalogue (blocking)

Run the local gate. It replays every finding recorded in `SECURITY_REVIEW*.md`; it is the source of truth — do not re-implement its checks here.

```bash
./scripts/security-checks.sh --offline
```

Every failing guard is blocking. CI runs the same script.

## Step 2 — Invariants (read the diff against each)

For each item, confirm the diff still holds it. One bullet per invariant, naming the decision record or the finding it comes from.

TODO(harness): the invariants of this project's architecture. The kind of bullet that belongs here:

- **Ownership before write** — a write that takes an identifier from the request checks that the caller owns the target first.
- **Audit on mutation** — every create, update and delete leaves an audit entry; secrets and encrypted fields never appear in it.
- **Bounds on input** — every free-text field has a maximum length, every number a range, every array a maximum size.
- **Output encoding** — cells written to a spreadsheet or CSV are neutralised against formula injection.
- **Errors** — a failure never returns internals (stack, query, path) to the caller.

Replace these with your own; an invariant that a guard already enforces names the guard ID.

## Step 3 — The scanner for the area touched

| Diff touches | Run |
|---|---|
| `.github/workflows/**` | zizmor at the pinned version — unpinned actions, template injection, dangerous triggers, token over-permission (the gate runs it when the `ci-security` module is installed) |
| Dependency manifests or lockfiles | the ecosystem's audit at the project's severity threshold; a derogation is per advisory, with a reason and a review date |
| Container or infrastructure files | a configuration scanner (Trivy config or equivalent) |
| A new credential format the application issues | a rule in `.gitleaks.toml`, so a leaked one is recognised |
| A Claude Code plugin, skill or MCP server | read it in full at a fixed commit before use; record the commit in `scripts/reviewed-plugins.json` |

TODO(harness): rows for the surfaces of your own (an API gateway, a mobile build, a data pipeline).

A scanner is run from a pinned release verified by checksum, never `curl … | sh`.

## Step 4 — Findings policy

Per CLAUDE.md § "Findings policy": every finding from this skill, a scanner, `/security-review` or CI is fixed before merge, or carries an explicit, motivated derogation recorded in the Derogations table of `SECURITY_REVIEW.md` and named in the pull request. A fixed finding gets its ID, its row in `SECURITY_REVIEW.md` and its guard — and, when it reveals a rule the architecture relies on, a bullet in Step 2.
