bump: patch

- `ready-on-green`: the page says when the `session-active` label comes off, and how a CI workflow can hold its jobs while it is on. The session removes the label once its work is done. With CI that runs in full on every push, the session lifts the draft itself only when CI has already ended green on the head, and otherwise leaves that to the workflow. With a CI workflow that holds its jobs — every job skipped while a draft carries the label, a run when the label comes off or a held draft is lifted —, removing the label runs CI once, in full, and the workflow lifts the draft. The page has the lines to copy, and why every job must carry them: a held run must end `skipped`, never `success` on checks that never ran. A label left behind keeps the pull request a draft, the safe side, until someone removes it.

By hand: nothing. To have CI hold its jobs while a session works, copy the lines of the page (§ A CI workflow that holds its jobs) into the CI workflow, onto every job.
