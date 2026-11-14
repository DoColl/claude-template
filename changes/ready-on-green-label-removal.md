bump: patch

- `ready-on-green`: the page says when the `session-active` label comes off. The session removes it once its work is done; it lifts the draft itself only when CI has already ended green on the head, and otherwise leaves that to the workflow. A label left behind keeps the pull request a draft, the safe side, until someone removes it.

By hand: nothing.
