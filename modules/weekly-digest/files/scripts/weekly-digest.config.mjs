// Project settings of the weekly digest (docs/conventions/weekly-digest.md).
// This file is yours: the kit never overwrites it. scripts/weekly-digest.mjs
// checks it on import, so a mistake here fails the self-test (WD-1).
export default {
  // The branch pull requests are merged into.
  defaultBranch: '__HARNESS_DEFAULT_BRANCH__',

  // The `name:` of the CI workflow a pull request waits for. The digest looks
  // up the workflow file that carries this name; if there is none, it lists
  // pull requests on conflicts and age only, and says so.
  ciWorkflow: '__HARNESS_CI_WORKFLOW__',

  // Days a scheduled workflow's last scheduled run may age before the digest
  // reports it. Every workflow with a `schedule:` is watched with a 9-day slack
  // (a weekly cron, fired late). List here the ones that run more often, by
  // file name:
  //   'nightly.yml': 3,
  maxAgeDays: {},

  // Documentation paths the CI workflow runs on all the same. A pull request
  // touching only documentation gets no CI run, and the digest does not expect
  // one — unless the CI workflow takes some paths back after skipping Markdown
  // (the Claude instruction files, typically). The digest reads them from the
  // `pull_request` trigger of the CI workflow: the `paths` entries after the
  // last `!` exclusion. Set this only when WD-1 says it cannot read them, with
  // ASCII letters and digits, `_ . - @ /`, `*` and `**` only (a `?`, `[…]` or
  // `{…}` pattern written as the paths it covers, any other character as `*`):
  //   ciAlsoRunsOn: ['.claude/**', '**/.claude/**', 'CLAUDE.md', '**/CLAUDE.md'],
};
