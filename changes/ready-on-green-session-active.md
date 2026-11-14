bump: minor

- `ready-on-green`: a draft pull request labelled `session-active` keeps its draft whatever CI says. A session still at work on its pull request — a review running, a commit to come — says so with the label, then removes it and lifts the draft itself when its work is done. RG-4 checks that the label is read and acted on before the pull request is named to the step that lifts the draft; that step is tested on a table of pull requests. Not run live.

By hand: nothing. To use it, create the label once: `gh label create session-active`.
