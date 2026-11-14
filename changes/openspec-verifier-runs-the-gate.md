bump: patch

- `openspec`: the next steps and the page no longer tell a project with the `agents` module to add `openspec validate` to the verifier's config. At 1.10.0 the bare command sends a usage event to the CLI's telemetry unless `OPENSPEC_TELEMETRY=0`, `DO_NOT_TRACK=1` or `CI` is set; that config must list nothing that reaches the network, and the Bash guard accepts no prefix that would turn telemetry off. The verifier validates by running the gate, where OS-1 sets `OPENSPEC_TELEMETRY=0`. The page now says when the CLI reaches the network.

By hand: a project that followed the old step removes the `openspec validate` entry from `.claude/hooks/agent-bash-guard.config.json`; the verifier validates through `scripts/security-checks.sh --offline`.
