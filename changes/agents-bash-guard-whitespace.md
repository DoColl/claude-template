bump: patch

- `agents`: the Bash allowlist of the read-only agents refuses whitespace other than a space, a tab or a newline anywhere in a command, quoted or not. Its tokenizer split words on what JavaScript calls whitespace — a carriage return, a vertical tab, a form feed, a no-break space and a dozen other Unicode spaces — and trimmed it from the ends of a segment, where the shell separates words on a space or a tab only. After an accepted environment prefix, that let any program run: the guard checked `LC_ALL=C<VT>cat rm README.md` as a `cat` of two files, the shell read one assignment word and ran `rm README.md` (also seen through a live Bash tool, with U+3000). Present since the first version; the specification has rows for each character, the blocked forms and the tab that stays allowed.
- The specification's sample verification command is `make check`, where it was `openspec validate`, which the `openspec` page now says never to list.

By hand: nothing.
