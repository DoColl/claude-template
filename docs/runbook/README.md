# Runbooks

Procedures someone follows under pressure: release, rollback, restore, secret rotation, incident response. A runbook is written to be executed top to bottom by a person who did not write it.

- One procedure per file, steps numbered, each step a command or an observable check.
- Say what "done" looks like, and how to undo each step that can be undone.
- Never put a secret in a command line or in the file; say where the secret is read from.
- A procedure that has never been run is a draft: say so at the top until it has been.
- When a procedure changes, the runbook changes in the same commit.

## Index

| File | Procedure | Last exercised |
|---|---|---|
<!-- TODO(harness): one row per runbook. -->
