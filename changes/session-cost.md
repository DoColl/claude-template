bump: minor

- `core`: a rule on what a session spends on sub-agents, `docs/conventions/session-cost.md`, with its bullet in `CLAUDE.md` § Key conventions: bulk agent work on a light model named on each call, an estimate and a go-ahead before more than five agents, one pass by default, a fix loop stopped after one round that did not converge, and the rule held for the whole session. `/retro` counts a run that broke it among the incidents. `agents`: `delegation.md` points to it.

By hand: `CLAUDE.md` is yours, so the new bullet is not added to an installed project: copy it from the kit's `modules/core/files/CLAUDE.md` into § Key conventions, name your light model there, and add the row of `session-cost.md` to `docs/conventions/README.md`.
