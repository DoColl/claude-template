bump: patch

- Status lines that understated what has run, corrected from the runs' logs. `weekly-digest` ran once live on the kit's own repository: the scheduled trigger, the reads, the labels and the issue with its assignment worked; its other sections, the closing of a previous digest and whether the assignment notified were not seen. `ready-on-green` was refused twice — the second time on the commit adding `contents: write`, which a `workflow_run` workflow only uses once it is on the default branch — then lifted the drafts of several pull requests.
- The pages had not followed the runs they record elsewhere: `auto-merge`'s Status now names its second live run, with `TEST_HOLD_RE` set, in which the gate held a reworded test line; `claude-review`'s names the same run, in which the review passed that pull request and held the removal of an assertion. The next steps of `claude-review` and `claude-rework` said "never run live", and the `/retro` part of the gate's page said so of a closing form that has run. Each page, `README.md` and the modules' next steps now say what was seen, and nothing more.

By hand: nothing.
