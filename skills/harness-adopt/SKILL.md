---
name: harness-adopt
description: Bring a repository that already has its own Claude Code harness — hooks, guards, agents, workflows written by hand at the paths the claude-template kit uses — under the kit, module by module, without losing what the project wrote. Use when the user asks to adopt, migrate or converge an existing repository onto claude-template, or when `init --dry-run` lists many conflicts.
---

# Adopt an existing repository into claude-template

The kit is a checkout of the `claude-template` repository on this machine (`$CLAUDE_TEMPLATE_DIR`, or ask). Its installer is `<kit>/bin/harness.mjs` (Node >= 20). A repository with no `.claude/harness.json` and no file at the kit's paths takes the `harness-init` skill instead.

`adopt` writes what `init` would, except that a kit file the project already has with other content is kept and recorded as a kit file edited in the project. Adopting makes the gap visible; it does not close it. Closing it is a decision per file, and it is the user's.

## 1. One module at a time

Never `--all`. Start with the dry run of the candidates and read the table it ends with:

```bash
node <kit>/bin/harness.mjs list
node <kit>/bin/harness.mjs adopt . --modules <ids> --dry-run
```

- **by module**: `identical` and `adopted` say the project already has that module's files; a module with only `created` is one the project does not have — installing it is a new decision, not an adoption. Ask before including it.
- **adopted**: `+N / -M` are the lines found on one side only. Small numbers on both sides: a near copy. A large `+`: the project put its own logic in the kit's file.
- **fragments NOT inserted**: sections for an instruction file that has no slot.

Propose an order to the user: the modules with the smallest gaps first, one pull request per module.

## 2. Decide each adopted file

Compare it with the kit's version:

```bash
node <kit>/bin/harness.mjs show . <file> --modules <ids> | diff - <file>
```

Then one of three outcomes — say which you propose and why, and let the user choose:

- **Take the kit's version.** The difference is wording, or an older copy of the same piece. After adopting: `node <kit>/bin/harness.mjs update . --only <file> --force`.
- **Keep the project's version, and move what is specific out of it.** The file mixes the kit's machinery with project rules: move the project's part to the seed meant for it (`scripts/guards.d/50-project.sh` for guards, a config file the piece reads, a placeholder set with `update . --set KEY=VALUE`), then take the kit's version. Do this in its own commit, and run the gate before and after: the same checks must still fail on the same breakage.
- **Keep the project's version as it is.** It does something the kit's does not. Leave it adopted; tell the user it will be a conflict whenever the kit changes that file, and that the improvement belongs in the kit — as an issue or a pull request there, not copied by this session.

Never `--force` over a file to shorten the list, and never weaken a guard, an allowlist or a merge gate to make the project's file match the kit's: when the two differ on a security condition, keep the stricter one and say so.

## 3. Fragments

For each fragment the dry run names, read it (`<kit>/modules/<id>/fragments/...`) and the project's file. If the project's file already says it, it is declined; if it does not, propose where to paste it, or add the slot line the fragment expects. When every remaining one is covered:

```bash
node <kit>/bin/harness.mjs adopt . --modules <ids> --decline-fragments
```

## 4. Adopt, then verify

```bash
node <kit>/bin/harness.mjs adopt . --modules <ids>
git add -A && ./scripts/security-checks.sh --offline
node <kit>/bin/harness.mjs status .
```

The gate that runs is the project's if `scripts/security-checks.sh` was adopted, the kit's otherwise. A red guard after adoption usually means a kit guard reading a project file it does not understand: report it, do not edit the guard. One case to expect: an instruction file the project already had, adopted as `CLAUDE.md`, has no `harness:budget <bytes>` line, so CM-1 is red until the project adds one (a comment line is enough, `docs/conventions/claude-md.md`).

## 5. Hand over

- Do not commit unless the user asks. Everything here is executed by later sessions: it is read by a human before it lands.
- In the pull request description: the modules adopted, the kit version and commit (`.claude/harness.json`, `kit`), the files taken from the kit, the files kept and why, the fragments declined.
- List what stays adopted: those are the conflicts of the next update (`harness-update`).
- A post-install step that acts on a person's machine rather than on the project — installing a tool, starting a process, writing under `~` or into a shell profile, pointing sessions somewhere — is relayed word for word, never done by this session.
