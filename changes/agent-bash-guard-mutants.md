bump: patch

- `agents`: AG-1 also runs `.claude/hooks/agent-bash-guard.mutants.test.mjs`, a fixed list of broken copies of the allowlist's lib. Each one loosens one condition (deletes it, drops an anchor, makes a character optional, widens a class) and names the row of the specification that must catch it. The specification must fail on each, on that row. A mutant whose text no longer occurs once in the lib fails too, so that the list follows the lib. The five loosenings of the `cd` rule that two reviews had found uncaught are in it.
- `agents`: the specification's tables name every row they get wrong instead of stopping at the first, and two conditions got the rows they lacked: `cat` with no file at the start of a command, and a verification command fed by a pipe (both were already refused). `docs/conventions/agent-bash-guard.md` gets § Mutants.

By hand: nothing. A project that changed its copy of `agent-bash-guard-lib.mjs` will see AG-1 fail on the mutants whose text its change touched: update their find strings, or add a mutant and its row for a new condition.
