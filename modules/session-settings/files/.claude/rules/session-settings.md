---
paths:
  - ".claude/settings.json"
  - ".claude/settings.local.json"
---

# Session settings

`.claude/settings.json` denies reading secret files (`.env`, `.env.*`, `secrets/`; SS-1) and turns the Bash sandbox on. It never sets `bypassPermissions`, never allows all of Bash, never approves every project MCP server, never disables hooks (SS-2). Personal rules go in `.claude/settings.local.json`, which stays untracked (SS-3). → `docs/conventions/session-settings.md`
