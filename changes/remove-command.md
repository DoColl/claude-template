bump: minor

- New command `remove <dir> --modules a,b`: takes modules out of an installed project. It deletes their files that are still as installed, takes their sections out of the instruction files and their blocks out of `.gitignore`, and drops them from the manifest; a kit file edited in the project (unless `--force`), a project-owned file that was filled in and a reworded section stay and are listed, with exit 2. It refuses `core`, and a module another installed one requires unless both are named. `--dry-run` shows the plan.

By hand: nothing.
