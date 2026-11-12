# Claude in CI: plain issues only

**Rule (CLAUDE.md § Key conventions):** `claude.yml` answers `@claude` in a comment on a **plain issue** of a private repository, and nothing else — never a pull request, never an issue that carries third-party text. Its only GitHub credential is the job token. A change to the file updates the digest in `scripts/guards.d/44-claude-ci.sh`.

## Status

Ported from a workflow designed after a security review of running an agent in CI. **It has not been exercised end to end by the kit's authors** in this form: the first `@claude` in your repository is its test. Use a throwaway issue, then read the run log before relying on it. One piece was replayed locally, in throwaway repositories: the pre-push hook against the push wrapper of the pinned action. A session's own branch goes through; the default branch is refused.

## Why plain issues

A CI session holds a token and executes what it reads. The question is therefore whose text and whose tree reach it.

- On a **pull request**, the checkout is the pull request's tree: its code, but also its instruction files, settings and hooks — the files a session executes. Running an agent there hands the job's token to whoever wrote the pull request. The action has mechanisms to put trusted configuration back before a session starts; this kit does not rely on them as a boundary, and does not run Claude on pull requests at all. If you want that, evaluate it yourself at the action version you pin.
- `issue_comment` runs the **default branch's** workflow file, and on a plain issue the tree is the default branch. No unmerged file reaches a run.
- An issue whose text was not written by a collaborator is refused by its **label**: `dependabot-alert` (advisory summaries) and `weekly-digest` (titles gathered from pull requests). If another workflow of yours files third-party text as issues, give those issues one of these labels or add its label to the job's `if:`.
- The issue author and the commenter must both be an owner, a member or a collaborator of the repository (`author_association`). That is an association, not a permission level: a collaborator with read-only access passes it. On top of it, the action itself refuses to start for an actor without write access; never set its `allowed_non_write_users`.
- **Every comment of the issue reaches the session**, whoever wrote it. Only the issue's author and the author of the `@claude` comment are checked.

`@claude` in an issue's title or body does nothing: follow up with a comment.

## Private repositories only

On a public repository anyone can comment on an issue, and a session reads the issue's comments. The conditions above stop an outsider from *starting* a run; they do not stop an outsider's comment from being *read* by a run a collaborator starts. The run log (`show_full_output: true`) is also as visible as the repository. Do not enable this workflow on a public repository as it stands.

Private is not enough by itself. Anyone who can write in an issue of the repository — a client or a contractor with read-only access included — can put text in front of a session that a maintainer starts, in the issue body or in a comment, and an HTML comment there is invisible in the rendered view. Use the workflow only where every person with access is trusted to that degree.

## What a run holds

- **One GitHub credential, the job token.** `github_token` skips the App token exchange, so the job's `permissions:` are the real bound (`contents: write` to push a branch, `issues: write` to comment), there is no `id-token: write`, the token dies with the job, and its pushes start no workflow. The price: comments come from `github-actions[bot]`.
- **With the tools the action allows, it pushes its own branches only.** A session produces a `claude/issue-N-*` branch, and a global pre-push hook, installed in `$RUNNER_TEMP` before the session starts, refuses every other ref. The hook is needed: the action's own push wrapper refuses flags and other remotes but accepts any branch name, the default branch included. Where your plan allows it, add a branch ruleset that refuses direct pushes to the default branch. The token cannot open a pull request (no `pull-requests` permission).
- **That rests on the action, not on the token**, which can write any branch. The hook holds as long as a session can neither change git's configuration, nor skip hooks, nor call the API by itself. As read at the pinned commit, a session gets the read tools, file edits and a few file commands inside the workspace (the `acceptEdits` permission mode), `git add`, `git commit`, `git rm` and the push wrapper: no other git subcommand, no network client. Claude Code asks before a write under `.git/`, a protected path, and an unattended run has nobody to approve it (by its documentation; not tested here). Re-read all of it on every bump. The hook stops a push made by mistake or by a steered session using its tools; it is not a boundary around the token.
- **git is hardened.** `safe.bareRepository=explicit`: git will not adopt a repository layout found inside the workspace, whose configuration could run commands.
- **Assume the session can read every credential the job holds** (the job token, the Claude token). What bounds the risk is the input, not the output: no third party's text reaches a session.
- A session's branch **never merges unattended**. With the `auto-merge` module that is enforced (`claude/issue-*` heads and any change to `claude.yml` are held for a human); without it, do not auto-merge them.

## Accepted, in writing

Text written by a collaborator reaches the model, as does the default branch. A steered session could write a `claude/issue-*` branch and a comment, and what it read can end up in either. The full transcript is kept in the run log because it is the only record of what a session that can push did.

## On every bump of `claude-code-action`

A bump is a hand merge: nothing runs the action before it is merged, and the digest ignores pins. At the new commit, re-read what decides the properties above — the action's entry point and inputs (`action.yml`), how it obtains and configures the GitHub token, how it sets up git and branches, the tools it allows in this mode, and the Claude Code version it installs — then re-test on a throwaway issue. `actions/checkout` is pinned in the same file, so its bumps are hand merges too.

## Checks

`scripts/guards.d/44-claude-ci.sh`:

- **CC-1** — every workflow has a top-level `permissions: {}`.
- **CC-2** — `claude.yml` is the only workflow that names a Claude secret or action, and no workflow reads all the secrets (`secrets: inherit`, `toJSON(secrets)`…). One exception: `claude-review.yml`, the automated pull-request review, when `scripts/guards.d/45-claude-review.sh` pins it byte for byte too. Without that guard it is refused like any other.
- **CC-3** — `claude.yml` is byte for byte the reviewed file, pins aside. A deliberate change updates `CLAUDE_YML_DIGEST` in the guard, in the same pull request; the guard prints the new value.
- **CC-4** — the checks can fail: a table of broken copies must all go red, a pin bump must stay green, and the pre-push hook must refuse every ref but `claude/issue-*`.

They stop a regression, not a deliberate edit by someone who can change the guard too. That is what review of instruction and workflow files is for.

## History

- Installed with the kit. Differences from the workflow it was ported from: the issue author and the commenter must both be an owner, a member or a collaborator; `weekly-digest` issues are refused as well; the two zizmor exceptions (`dangerous-triggers` on `issue_comment`, `artipacked` on the checkout) are inline comments next to their justification instead of entries in `.github/zizmor.yml`.
- CC-2 lets in a second Claude workflow, the automated review, only next to the guard that pins it; a third one stays refused.
- A review of the kit asked what a session can really push. The action was read at the pinned commit and its push wrapper replayed against the hook; § What a run holds now states what was read instead of pointing at "the action's tool allowlist".
