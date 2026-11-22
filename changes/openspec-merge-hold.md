bump: minor

- `auto-merge`: `CLAUDE_GATE_RE` holds an OpenSpec configuration and its schemas at any depth (`openspec/config.yaml` or `.yml`, `openspec/schemas/`), and a bare `openspec` entry, which as a symlink would bring both along: the OpenSpec workflows hand them to a session as instructions, and they merged on green CI. AM-1 has rows for them, and for the neighbours that keep merging (`openspec/changes/x/tasks.md`, `openspec/specs/x/spec.md`, `docs/openspec-notes.md`). The rest of the tree still merges on green CI, stated in the policy page's § Residual risks with the line that holds it all.
- `weekly-digest`: `DEFAULT_GATE_RE`, its copy of that list, follows. `claude-rework`: `REWORK_HOLD_RE` holds the same paths, and the digest RW-1 checks is updated for that line.
- `openspec`: § Which of these files are instructions says what an unattended merge holds and how a project holds the whole tree.

By hand: nothing for the kit's list, which `update` refreshes. A project that wants every file under `openspec/` read before it merges adds `(^|/)openspec(/|$)` to `PROJECT_GATE_RE` (`update <dir> --set PROJECT_GATE_RE=…`) with a `hold` row in `scripts/auto-merge-paths.txt`. A project that edited `claude-rework.yml` sets the digest RW-1 prints.
