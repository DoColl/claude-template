bump: patch

- `ci-workflow`: CW-3 also refuses a workflow-level `defaults` key in `ci.yml`. Its `run.shell` reached the `changes` step, which could run under another shell and hand the jobs an empty verdict while the guard's table stayed green.
- A kit test now covers every workflow step whose script a guard runs (the lines between `# harness:<x>-begin` and `# harness:<x>-end`): with `if`, `continue-on-error`, `shell` or `defaults` added to the step, its job or the workflow, plain or quoted, the module's gate must go red. The module contract says so in § Guards.

By hand: a project whose `ci.yml` sets `defaults` at the workflow level moves it to the jobs that need it; CW-3 is red until then.
