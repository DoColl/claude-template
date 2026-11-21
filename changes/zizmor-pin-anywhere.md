bump: patch

- `ci-security`: a kit test reads every tracked text file of the kit (modules and the root copies, the changelog and the tests aside) and fails on a zizmor installed or pinned outside the GA-2 guard: a `zizmor==` or `zizmor@` pin, an install through `uvx`, `pipx`, `pip`, `uv`, `cargo`, `brew` or `conda`, the zizmor action or its image, a second `ZIZMOR_VERSION`. A bump of the guard can no longer leave a stale, unhashed copy behind.

By hand: nothing.
