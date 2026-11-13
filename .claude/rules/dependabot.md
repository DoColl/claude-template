---
paths:
  - ".github/dependabot.yml"
---

# Dependabot

Patch and minor groups stay separate, behind a `cooldown`; `ignore` holds the deliberate pins only, each with its reason. Dependabot does not see lockfile overrides, vendored code, patches or the scanner pins of `security.yml` — the periodic audit stays the net. → `docs/conventions/dependabot.md`
