bump: patch

- `auto-merge`: the dispatch recipe of the policy page (§ After the merge) checks the merge commit before it dispatches, with the pattern the check of what the merge wrote uses, and gives the line to write; the merge step can hand over `-` or nothing when GitHub named no commit. The recipe now says that every dispatch step carries the whole condition, and why a red check dispatches nothing, a scan included: the dispatched run is the default branch's copy of the target as the merge left it, which such a merge may have changed. The workflow is unchanged: it dispatches nothing.

By hand: in a project that added a dispatch step after the merge, add the check of `$MERGE_SHA` against `^[0-9a-f]{40,64}$` before the dispatch, and make sure the step's condition names both `steps.merge.outputs.merged == 'true'` and `steps.check.outcome == 'success'` (the policy page, § After the merge, step 2).
