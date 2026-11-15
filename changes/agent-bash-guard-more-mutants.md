bump: patch

- `agents`: thirteen more mutants of the allowlist's lib, for conditions a row of the specification caught but no mutant pinned: the backslash at the end of a segment (deleted, blanks not looked through, a tab not counted as a blank), the `~` and the `..` at the start of an argument, and in the verification config the `git` and `sudo` heads, a command starting with `-` or `/`, a command holding `=` or `..`, an option value that is an absolute path, and a `cwd` holding `..`. The header of the list now also names the `~` of the config's checks as backed up by the token class, and says why `|&` needs no mutant: the one form that passes without its check only moves standard error.

By hand: nothing. A project that changed its copy of `agent-bash-guard-lib.mjs` will see AG-1 fail on the new mutants whose text its change touched: update their find strings.
