# Security policy

This kit installs files that every Claude Code session executes, a hook that confines sub-agents, and workflows that merge with nobody watching. A flaw in one of them is a flaw in every project that installed it.

## Reporting a vulnerability

Report it privately, through GitHub's private vulnerability reporting: the **Security** tab of this repository, then **Report a vulnerability**. Do not open a public issue or pull request for it.

Say which piece is affected (a module, the installer, a workflow), at which commit of the kit, and how to reproduce it: the command or the pull request shape that gets past the check. A row for the piece's test table is the most useful form a report can take.

## What counts

- A command that gets past the Bash allowlist of the read-only agents (`modules/agents/files/.claude/hooks/`), beyond the limits its convention page already lists.
- A pull request that `auto-merge` merges unattended although it touches a path the policy says is held, or a merge of a commit CI did not validate.
- A way for third-party text or an unmerged tree to reach a `claude-ci` session, or for such a session to push elsewhere than its own branches.
- A write by the installer outside the target project, or an overwrite of a seed file.
- A guard that stays green on the change it is there to catch.

The limits each convention page states under "Limits" or "Accepted, in writing" are known and documented; a report that goes beyond them is welcome.

## Supported versions

The default branch only. A project refreshes its kit files with `node bin/harness.mjs update .` from an up-to-date checkout.
