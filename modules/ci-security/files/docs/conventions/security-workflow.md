# The security workflow: two tiers, pinned scanners

**Rule (CLAUDE.md § Security workflow):** `.github/workflows/security.yml` has an enforcing tier that blocks merges (gitleaks over the full history, then `./scripts/security-checks.sh`) and an advisory tier that only logs (Semgrep, Trivy, a Syft SBOM) and runs on standalone triggers. Every scanner binary the workflow downloads is a pinned release verified by sha256; zizmor, which the gate runs, is pinned to an exact version on PyPI, without a hash. All are bumped by hand with the procedure below.

## Status

Ported from production workflows. This generic variant has run on the kit's own repository: the enforcing job called from a CI workflow, on pull requests and on a push to the default branch, and one standalone run on a documentation push where the enforcing job and the three advisory jobs (Semgrep, Trivy, the Syft SBOM and its artifact) all completed. The weekly schedule and the manual dispatch have not fired yet. That repository has no application code and no package manifest: the advisory scanners ran, with next to nothing to find.

## Why

A check that blocks a merge has to be precise: every red run must point at something to fix. Deep scanners are not — their false-positive rate is too high to gate on each finding without triage, and a gate people learn to wave through is worse than none. So the two kinds of tool live in two tiers: the precise ones block, the noisy ones report, and a pattern that proves its worth in the advisory tier is promoted into a guard.

The enforcing tier is the project gate itself. `security.yml` does not re-implement the regression checks: it calls the script contributors run before pushing, so there is one list of checks and nothing to keep in sync between a laptop and a runner.

The scanners are pinned because the binary that decides what merges is itself an input. An install script fetched from a moving ref, or a "latest" binary, hands that decision to whoever controls the ref on the day of the run.

## Details

### The two tiers

- **Enforcing** — one job, on every invocation (called from CI, weekly cron, manual dispatch, docs-only push). Steps: checkout with full history and `persist-credentials: false`; gitleaks (`git --redact`, so a real leak is not copied into a log anyone with `actions: read` can open); the gate. Each check step carries `if: ${{ !cancelled() }}`: with the default, the first red step skips the later ones and one failure hides the others.
- **Advisory** — three jobs, `if: github.workflow == 'Security'`, which is true only on a standalone run: when a CI workflow calls this one, the `github` context is the caller's and `github.workflow` reads the caller's name. Skipped jobs bill nothing, and nothing gates on these jobs, so running them on every pull-request push would only buy billed minutes. Their steps end with `|| echo "::warning::…"`: they never fail the run.
  - Semgrep with the language-neutral `p/owasp-top-ten` pack. Add the packs of your languages as further `--config` lines.
  - Trivy on the repository tree: dependency CVEs from the lockfiles it recognises, infrastructure-as-code misconfiguration, hardcoded secrets.
  - Syft: a CycloneDX SBOM, kept 7 days as an artifact.

The dependency audit that blocks is not in this workflow: it is a guard of the gate, specific to the package ecosystem (`node-audit` module for npm, or a guard of your own).

### Wiring into CI

This module ships no CI workflow: the jobs depend on the stack. The kit's `ci-workflow` module installs the file below as `.github/workflows/ci.yml`, a skeleton that is yours from then on; without it, write the call into your own workflow. Either way, call `security.yml` as the first job and make the others wait for it, so that "CI is green" includes the enforcing tier:

```yaml
name: CI

on:
  push:
    branches: [__HARNESS_DEFAULT_BRANCH__]
    paths-ignore: ['docs/**', '**.md', 'LICENSE', '.gitignore']
  pull_request:
    branches: [__HARNESS_DEFAULT_BRANCH__]
    # The same set, as `paths` with negations: `paths-ignore` cannot take
    # anything back, and the last four lines must.
    paths:
      - '**'
      - '!docs/**'
      - '!**.md'
      - '!LICENSE'
      - '!.gitignore'
      - '.claude/**'
      - '**/.claude/**'
      - 'CLAUDE.md'
      - '**/CLAUDE.md'

permissions: {}

jobs:
  security:
    name: Security
    # `$/` is this repository at the caller's commit. `./` means the same to
    # GitHub, but zizmor reports it (self-repository) and GA-2 would fail.
    uses: $/.github/workflows/security.yml
    # The ceiling for the called workflow: its jobs can only narrow it.
    permissions:
      contents: read

  test:
    needs: [security]
    # … the project's own jobs
```

- The `paths-ignore` list of `push` and the `push.paths` list of `security.yml` mirror each other: a docs-only push skips CI and is scanned by the standalone trigger; a push touching code is scanned through the call. If your CI does not skip docs-only pushes, remove the `push` trigger from `security.yml`, or both will scan them.
- **Pull requests have no such second trigger**, so the `pull_request` filter must not skip the Claude instruction files with the rest of the Markdown. `CLAUDE.md` and the agent definitions under `.claude/` end in `.md`, and the gate has checks made for them (the `CLAUDE.md` budget and pointers, the hook line of each read-only agent where those are installed): with a plain `paths-ignore: ['**.md']`, a pull request that only edits them never runs the gate. Hence `paths` with `!` exclusions followed by the re-inclusions; a later pattern overrides an earlier one. The filter is written from GitHub's documented rules and has not been observed on a run of this kit: check it once, with a pull request that only touches `CLAUDE.md`.
- A called workflow cannot hold more permissions than the calling job grants. A job of `security.yml` that asked for more than `contents: read` would fail the whole CI run at startup.
- Until a workflow calls it, the enforcing job does not run on pull requests. The `30-github-actions` guard prints a note while that is the case.
- Do not rename the workflow (`name: Security`) without changing the `if:` of the advisory jobs.

### Concurrency

The concurrency group carries `github.workflow`, so a standalone run and the one CI calls never share a group. When they did, a push touching code and docs made them cancel each other, and when the called run lost, everything in CI that waited on it was silently skipped. A run on the default branch is never cancelled.

### Pinned scanners

| Tool | Where the pin lives | Verified at pinning time by |
|---|---|---|
| gitleaks | `security.yml`, job `enforcing`, step `env:` (version + sha256) | no signature published: the hash is cross-checked between the release's checksums file and the digest GitHub computes for the asset |
| zizmor | `ZIZMOR_VERSION` in `scripts/guards.d/30-github-actions.sh` | PyPI, exact `==` version |
| Trivy | `security.yml`, job `trivy`, step `env:` | `cosign verify-blob` on the checksums file |
| Syft | `security.yml`, job `sbom`, step `env:` | `cosign verify-blob` on the checksums file, plus the source commit |
| Semgrep | `security.yml`, job `semgrep`, container image digest | the digest itself |

`scripts/fetch-pinned-release.sh` downloads a release archive, refuses to unpack it unless the sha256 matches, and extracts the one binary. Dependabot follows none of these pins: bump them by hand, during the periodic audit or when a release fixes something that concerns you.

Rules for a bump:

1. **The release is at least 7 days old.** A compromised release is usually withdrawn within days — the same reasoning as Dependabot's `cooldown`.
2. **The hash comes from the release's checksums file**, after that file has been verified with `cosign verify-blob` when the project signs it. Exact signer identity, never a wide regular expression.
3. **Version and hash change in the same commit**, in the same `env:` block. If they diverge the step fails on `sha256sum --check`; that is the point.
4. **Re-triage after the bump**: a new gitleaks or zizmor brings new rules, hence findings on a repository that did not change.

Trivy (the signer identity names the tag):

```bash
V=0.76.0                      # the target version, published at least 7 days ago
d=$(mktemp -d) && cd "$d"
gh release download "v$V" -R aquasecurity/trivy -p "trivy_${V}_checksums.txt*"
cosign verify-blob "trivy_${V}_checksums.txt" \
  --bundle "trivy_${V}_checksums.txt.sigstore.json" \
  --certificate-identity "https://github.com/aquasecurity/trivy/.github/workflows/reusable-release.yaml@refs/tags/v$V" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
grep " trivy_${V}_Linux-64bit.tar.gz\$" "trivy_${V}_checksums.txt"   # → TRIVY_SHA256
```

Syft (released from the main branch by a manual dispatch, so the identity does not name the version — hence the extra check on the source commit):

```bash
V=1.54.1
d=$(mktemp -d) && cd "$d"
gh release download "v$V" -R anchore/syft -p "syft_${V}_checksums.txt*"
src=$(gh api --paginate "repos/anchore/syft/tags?per_page=100" --jq ".[] | select(.name==\"v$V\") | .commit.sha")
cosign verify-blob "syft_${V}_checksums.txt" \
  --bundle "syft_${V}_checksums.txt.sigstore.json" \
  --certificate-identity "https://github.com/anchore/syft/.github/workflows/release.yaml@refs/heads/main" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-github-workflow-sha "$src"
grep " syft_${V}_linux_amd64.tar.gz\$" "syft_${V}_checksums.txt"     # → SYFT_SHA256
```

gitleaks (no signature: the two values below must be equal):

```bash
V=8.30.1
d=$(mktemp -d) && cd "$d"
gh release download "v$V" -R gitleaks/gitleaks -p "gitleaks_${V}_checksums.txt"
grep " gitleaks_${V}_linux_x64.tar.gz\$" "gitleaks_${V}_checksums.txt"
gh api "repos/gitleaks/gitleaks/releases/tags/v$V" \
  --jq ".assets[] | select(.name==\"gitleaks_${V}_linux_x64.tar.gz\") | .digest"   # sha256:<the same hash>
```

zizmor: change `ZIZMOR_VERSION` in the guard — the one place, read by the gate here and in CI.

Semgrep: resolve the tag you want to its digest and replace the `image:` line, keeping the tag and the date in the comment above it:

```bash
docker pull semgrep/semgrep:latest
docker inspect --format '{{index .RepoDigests 0}}' semgrep/semgrep:latest
```

After a bump:

- **gitleaks** — rescan the history the way CI sees it, output redacted: `gitleaks git --redact --no-banner -v .`. A false positive that a rule can describe exactly (a variable name taken for a secret) gets a targeted `[[allowlists]]` entry in `.gitleaks.toml`; otherwise a fingerprint in `.gitleaksignore`, together with the fix that cleans the working tree. A real secret is rotated first and purged afterwards.
- **zizmor** — `./scripts/security-checks.sh` runs the new version at every severity; each new finding is fixed, or ignored in `.github/zizmor.yml` with its justification. Without that triage every pull request fails.
- **Trivy, Syft, Semgrep** — advisory, nothing blocks: run the Security workflow by hand (`workflow_dispatch`) and read the three jobs.

### What is deliberately absent

- **Language-specific linters** (security plugins of a linter, type-aware analysers): they belong to the stack. Add them as advisory jobs with the same shape — pinned version, `if: github.workflow == 'Security'`, a step that ends in a warning.
- **CodeQL**: its licence covers public repositories, and private ones only under GitHub's paid code-security offering. Add it if the repository qualifies, and upload its results somewhere someone reads them.
- **Container image scanning**: Trivy here reads the repository tree, never a built image. Scanning images needs a registry token, which a called workflow capped at `contents: read` cannot hold — give it a workflow of its own.

## Checks

- **GA-1, GA-2** (`scripts/guards.d/30-github-actions.sh`) apply to this workflow like any other: every `uses:` pinned to a SHA, zizmor at zero.
- The workflow is the check for everything else: it runs the gate.

## History

- Installed with the kit.
