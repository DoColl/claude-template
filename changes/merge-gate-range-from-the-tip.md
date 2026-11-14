bump: patch

- `auto-merge`: both merging jobs list what a pull request brings from the base branch's tip, read by its full ref right before listing, instead of from the pull request's `base.sha`. GitHub leaves `base.sha` where the branch was at the pull request's last push, while a squash applies the head's changes since its merge base with the current tip. When a branch the head had merged landed on the base branch afterwards, a squash that set a held path back — a hook, a convention page, a line of a test under `TEST_HOLD_RE` — was not in the listing and merged unattended. Reproduced with the workflow's own steps against a local stand-in for the API (never seen on GitHub): from `base.sha` such squashes merged, from the tip they are held. AM-7 pins the new anchor: the tip read by `git/ref/heads/<branch>` after a check of the branch's name, an unreadable tip failing the job, nothing read from `base.sha`; seven ways of undoing it each turn it red.
- `claude-review`: the review reads its diff from the same tip, so that it reviews what the merge brings. `CLAUDE_REVIEW_DIGEST` follows.

By hand: nothing.
