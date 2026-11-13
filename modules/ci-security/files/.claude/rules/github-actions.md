---
paths:
  - ".github/workflows/**"
  - ".github/actions/**"
  - ".github/zizmor.yml"
---

# GitHub Actions

zizmor stays at zero findings, every severity (GA-2), and every `uses:` is pinned to a full SHA (GA-1). `permissions: {}` at workflow level plus minimal per-job blocks; `persist-credentials: false` on every checkout unless the job pushes; no `${{ … }}` inside `run:` — go through `env:`; every `upload-artifact` declares `retention-days`. Unfixable finding → `.github/zizmor.yml` with its justification. → `docs/conventions/github-actions-rules.md`
