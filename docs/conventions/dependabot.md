# Dependabot

**Rule (CLAUDE.md § Key conventions):** patch and minor updates stay in separate groups, behind a `cooldown`; `ignore` holds the deliberate pins only, each with its reason. Dependabot does not see lockfile overrides, vendored code, patches or the scanner pins of `security.yml`: the periodic audit stays the net.

## Why

Dependabot is the cheapest way to keep dependencies and action pins current, and the easiest to misread as coverage. It proposes; it does not audit. The configuration below makes its pull requests small enough to trust in batches, slow enough to dodge a freshly compromised release, and honest about what it never looks at.

## Details

Config: `.github/dependabot.yml`, weekly. The kit ships the `github-actions` ecosystem — it keeps the 40-character SHA pins current, which GA-1 enforces — and a commented block showing the shape for the project's own ecosystems.

- **Grouped patch and minor, deliberately split.** Each ecosystem declares a `*-patch` and a `*-minor` group rather than one mixed group. A minor group whose CI goes red must not hold the patches, and where merges are unattended the two do not deserve the same trust. Majors stay ungrouped: each is a decision.
- **A dependency joins the first group it matches.** A group that must not hold the others — actions pinned in a workflow that is always merged by hand, for instance — is declared first.
- **`cooldown`** keeps a freshly published version out of the merge path: a compromised release is usually withdrawn within days. Use a shorter delay for a patch than for a minor where the ecosystem supports per-semver days, a flat delay otherwise. It does not apply to **security updates**, which are proposed at once.
- **`ignore` = the deliberate pins.** A major that is a migration to schedule, a set of packages that must move together through their own tool, a version coupled to something no pull-request check exercises. Each entry carries its reason as a comment. A pin without a reason is drift waiting to be rediscovered.
- **`open-pull-requests-limit`**: past the limit Dependabot opens nothing, groups included. Set it above the number of groups the ecosystem can open in one week.
- **Pull requests on `.github/workflows/**` may need a hand merge.** A merge made with `GITHUB_TOKEN` can be refused for workflow files unless the token has `workflows: write`, which nothing automated should hold. When an automated merge fails with a 403 while CI is green, merge by eye; nothing is broken.
- **If merges are unattended** (the auto-merge module), its gate reads the update metadata of these pull requests. Read that module's convention page before adding a group, and never add an `allow:` key without it: widening what version updates cover changes what the gate believes about a pull request.

### Blind spots

Dependabot neither updates nor warns about:

- **lockfile overrides or resolutions** — including when an override is itself pinned to a vulnerable version, which is exactly where forced fixes accumulate;
- **vendored code and patches** applied at install time;
- **tool pins held in a workflow's `env:`** — the scanner versions and checksums of `security.yml`, bumped by hand (`docs/conventions/security-workflow.md` § Pinned scanners);
- **image references outside a Dockerfile** — `services.<id>.image` in a workflow, and compose files unless their ecosystem is enabled.

Dependabot does not replace the periodic audit; it complements it.

### Couplings semver cannot express

When two versions must move together — a test runner and the container image that ships its browsers, a runtime and its type definitions — Dependabot will bump one side alone and a green check may prove nothing. Give each such coupling a guard in `scripts/guards.d/50-project.sh` that names both sides and says which one to bump.

### Remediating a transitive advisory

Prefer a targeted update of the one package, then read the lockfile diff and refuse any change outside the advisory's package. A blanket "fix everything" command resolves an advisory by whatever change satisfies the resolver, including downgrades of unrelated packages.

## Checks

- **GA-1** keeps the action pins in the form Dependabot maintains (`@<sha> # vX.Y.Z`).
- Nothing checks the shape of `dependabot.yml` itself in this module. The auto-merge module adds its own guard on it.

## History

- Installed with the kit.
