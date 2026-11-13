# GitHub Actions rules (zizmor at zero)

**Rule (`.claude/rules/github-actions.md`, loaded when a session reads or edits a file under `.github/workflows/` or `.github/actions/`, or `.github/zizmor.yml`):** zizmor reports nothing on `.github/workflows/`, at any severity (GA-2), and every `uses:` is pinned to a full commit SHA (GA-1). `permissions: {}` at workflow level with minimal per-job blocks; `persist-credentials: false` on every checkout unless the job pushes; no `${{ … }}` inside `run:`; every `upload-artifact` declares `retention-days`. An unfixable finding goes to `.github/zizmor.yml` with its justification.

## Why

A workflow is code that runs with a token, on events other people can trigger, with dependencies fetched at run time. The usual review reads it as configuration. zizmor reads it as an attack surface — unpinned actions, template injection, dangerous triggers, over-broad tokens, credentials left on disk — and it is fast enough to run on every push. Keeping it at zero means a new finding is always the change that was just made, not one more line in a backlog nobody reads.

Zero is the rule at every severity, not only the blocking ones: a low finding that is tolerated today is the context in which the next one looks normal.

## Details

A new workflow or job keeps zizmor at zero. The rules that get it there:

1. **`permissions: {}` at workflow level**, plus an explicit block per job granting only what that job uses — `contents: read` for a checkout, nothing at all for a job that never touches the API. A workflow-wide grant hands every job the widest job's token, including the jobs that run third-party tools on the checked-out tree.
2. **`persist-credentials: false` on every `actions/checkout`.** The default leaves the token in `.git/config`, where every later step and anything it executes can read it. Only a job that actually pushes to the remote opts back in.
3. **No `${{ … }}` inside a `run:` body.** An expansion is spliced into the shell *source* before the shell parses it, so a value containing a quote or a `$(…)` becomes code. Route it through `env:` and reference `"$VAR"`. This covers `steps.*.outputs.*`, `job.status` and `secrets.*` alike.
4. **No cached executable feeding a publishing job.** A cache restored into a job that builds or publishes something is an input nobody reviewed. Some setup actions cache their own binary by default (turn that off in a job that publishes); a cache of *data* (build layers) is fine.
5. **Every `uses:` is pinned to a 40-character commit SHA**, with the version in a trailing comment (`@<sha> # v1.2.3`), or to an image digest for `docker://` references. A tag or a branch moves with whoever controls the action's repository. Dependabot keeps the pins current and maintains the comment. A pin is copied from a release you looked at — never typed from memory, never invented.
6. **A reusable workflow or a local action of the same repository is referenced with `$/`** (`uses: $/.github/workflows/x.yml`): this repository at the caller's commit. `./` means the same to GitHub but zizmor reports it (`self-repository`).
7. **A tool is installed from a pinned release verified by checksum** (`scripts/fetch-pinned-release.sh`), or at an exact version from its package index — never `curl … | sh`, never "latest".

### Artifacts and storage

Storage for run artifacts and run logs is capped by the plan, and past the cap GitHub **refuses uploads**: a full quota is a CI availability failure, not a billing line.

- Every `upload-artifact` declares an explicit `retention-days`. An artifact that only feeds a later job of the same run gets `1`.
- **No delivery path may depend on the artifact store.** If a release job needs a file a build job produced, give it another transport (a URL the build returns, a registry), and make the artifact upload `continue-on-error` only when that other transport succeeded — otherwise a quota failure must fail the job rather than ship a release with nothing in it.
- An upload that can collide on a re-run sets `overwrite: true`.
- Some build actions upload a record per build without being asked (the Docker build action does, unless `DOCKER_BUILD_RECORD_UPLOAD: false`). Look at what a run actually stores before blaming the artifacts you declared.
- Lower the repository's retention for artifacts and logs (Settings → Actions → General). Deleting a run deletes its logs and its artifacts; a retention change is not retroactive.
- A package registry has its own quota. Prune images by age, never "untagged only": the untagged versions are usually the children of a tagged multi-platform index, and deleting them alone corrupts every tagged image still present.

### Triage

A finding is fixed. When it cannot be — the trigger is the design, the action has no safer mode — the decision is recorded in `.github/zizmor.yml`: the rule, the file and **line**, and a comment saying why the trigger or pattern is needed, who can reach it and what bounds the job. Entries are anchored to one line on purpose: an edit above shifts the finding off its ignore, it comes back, and someone looks at it again. Never a whole-file ignore, never a rule disabled globally. It is the same bar as any derogation under the findings policy.

### Running it

```bash
./scripts/security-checks.sh --offline    # GA-1 always; GA-2 from uv's cache, without touching the network
./scripts/security-checks.sh              # fetches the pinned zizmor on first use (uvx, else pipx)
```

Offline, GA-2 runs only if `uvx` is installed and the pinned version is already in its cache; with `pipx` alone it is skipped, because pipx cannot be told to stay off the network.

zizmor runs with its own `--offline` flag in both places: no GitHub token, so the audits that query the API (impostor commits, known-vulnerable actions) do not run. The pinned version is `ZIZMOR_VERSION` in the guard; bumping it is a deliberate change followed by a triage of what the new version reports (`docs/conventions/security-workflow.md` § Pinned scanners).

## Checks

- **GA-1** — every non-local `uses:` under `.github/` names a 40-char SHA or a sha256 digest. Pure grep: it runs everywhere, with no tool.
- **GA-2** — zizmor at the pinned version reports nothing on `.github/workflows/`. Skipped on a machine with neither `uvx` nor `pipx`, and offline without a cached copy; a failure on a CI runner, where it is mandatory.

Both are in `scripts/guards.d/30-github-actions.sh`.

## History

- Installed with the kit.
