# A fresh-context review of the kit's security-sensitive pieces

**Rule (CLAUDE.md § Before pushing):** a change to a security-sensitive piece is read, before it is pushed for review, by an agent or a session that did not write it. It reads the complete diff against the piece's threat model; each finding is fixed or answered; the pull request says which review ran. A fix made for one of its findings is read the same way.

This page is the kit's own: it applies to sessions working on this repository. The review tiers a project receives (`review-tiers.md`) are installed by `core` and are the project's.

## Why

The checks `CLAUDE.md` asks for before a push — the tests, the gate, zizmor on a rendered project, a guard broken by hand in a scratch project — prove what they check. On the allowlist and the merge gate, several changes in a row passed all of them, and reviewers who had not written the change then found what they had not:

- a configuration file read before the configured one, so that a pull request adding an allow-all file silenced the scan that judged it;
- a bypass of the read-only agents' allowlist through whitespace the shell does not split on;
- a regression brought in by the fix for an earlier finding: a listing capped by the API matched a count taken from another merge base;
- conditions of a new allowlist rule that no row of its specification exercised.

The author reads a diff with the intent in mind and sees what was meant. A reader without that intent reads what the code does. The second reading is what found these defects, and a fix written in a hurry under review is where the next one came from.

## Details

- **The pieces**: the Bash allowlist and its tests (`modules/agents/files/.claude/hooks/`); the modules `auto-merge`, `claude-ci` and `claude-review`; the guards and kit tests that pin them (AG, AM, CC and CR, and their rows in `test/`). A change that only rewords their convention pages is not one, unless it changes what a reader is told is allowed.
- **Who reads**: a sub-agent started for it with no part in writing the change, or another session. The brief gives the diff, the piece's convention page and the threat it guards against, not the author's conclusion; an agent handed the author's view tends to return it confirmed.
- **What it reads**: the complete diff against `origin/main`, not the last commit.
- **Before the push for review**: findings are fixed, or answered in one line each (why it is not a defect, or why not now). A session whose container may end before the review does may push its branch as a draft that carries `session-active`, its description saying at the top that the review is not done; the label comes off only once the findings are settled.
- **A fix gets its own reading**: the commit that fixes the review's findings is read again in a fresh context, on that commit's diff. The gate re-running green says nothing about a condition the fix loosened.
- **In the pull request**: a `## Review` part names the review that ran (an agent, a skill such as `/security-review` or `/code-review`, another session), the commit it read, and what became of each finding.
- **Stricter form wins**: when a reviewer and the author disagree on whether a form must stay refused, it stays refused until the user decides (`CLAUDE.md` § Rules).

## Checks

None: nothing mechanical can tell who read a diff. The `## Review` part of the pull request is a statement, read by whoever merges; every pull request here is merged by hand.

## History

- Written for the kit, after several changes to the allowlist and the merge gate passed every listed check and were then found faulty by a reader who had not written them.
