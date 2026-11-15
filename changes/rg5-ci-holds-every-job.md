bump: minor

- `ready-on-green`: a new check, RG-5. When the CI workflow named at install holds a job while a draft is labelled `session-active`, every job must carry the hold as the page writes it (alone, or followed by `&&`), and its `pull_request` types must list `unlabeled` and `ready_for_review`. A run with some jobs held ends `success` on checks that never ran, and the draft could be lifted on it. A CI workflow without the hold is not concerned.

By hand: nothing. A project whose CI holds only some jobs, or whose types are not on one line, sees RG-5 red: give every job the hold, and list the types as `types: [ … ]`.
