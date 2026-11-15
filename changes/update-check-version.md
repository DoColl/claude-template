bump: patch

- `update --check` exits 3 when the only thing behind is the kit version the manifest records: `update` would still write it, and the "By hand" steps of the versions crossed stay listed until it does. A check with `--modules` or `--only` leaves the version out, since a selection never writes it.

By hand: nothing. A project's CI that runs `update --check` may now go red on a kit release that changed none of its files; run `update` once to record the version.
