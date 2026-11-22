bump: patch

- `core`: a fix made in a project can also show a gap in the kit. `/retro` step 3 now lets such an incident keep its destination and also get a drafted kit issue (step 5) for the missing rule, and the Findings policy of the `CLAUDE.md` skeleton asks for the same draft when a finding comes from an audit, a review or an issue rather than from a session.

By hand: a project that already has its `CLAUDE.md` adds one sentence at the end of § Findings policy: "When a finding is not specific to this project and the kit has no rule or check for its class, also draft an issue for the kit (`/retro` step 5)." The skill arrives with `update`.
