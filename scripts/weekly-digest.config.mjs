// Project settings of the weekly digest (docs/conventions/weekly-digest.md).
// This file is yours: the kit never overwrites it. scripts/weekly-digest.mjs
// checks it on import, so a mistake here fails the self-test (WD-1).
export default {
  // The branch pull requests are merged into.
  defaultBranch: 'main',

  // The `name:` of the CI workflow a pull request waits for. The digest looks
  // up the workflow file that carries this name; if there is none, it lists
  // pull requests on conflicts and age only, and says so.
  ciWorkflow: 'CI',

  // Days a scheduled workflow's last scheduled run may age before the digest
  // reports it. Every workflow with a `schedule:` is watched with a 9-day slack
  // (a weekly cron, fired late). List here the ones that run more often, by
  // file name:
  //   'nightly.yml': 3,
  maxAgeDays: {},
};
