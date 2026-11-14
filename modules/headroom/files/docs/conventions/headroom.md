# Headroom, per machine

**Rule (CLAUDE.md § Key conventions):** Headroom, a proxy that compresses what a Claude Code session sends, is set up by a person on their own machine, with the launch below. A session never installs it or starts its proxy unless that person asks, never puts `ANTHROPIC_BASE_URL` in a settings file (local ones included), and never uses Headroom's own installers (`headroom wrap`, `init`, `mcp install`, `learn`, its plugins). No committed file names, runs or reaches Headroom, and none reroutes a session's traffic (HR-1, within the limits listed below); Headroom's local state and `learn` blocks stay out of git (HR-2, HR-3).

## Status

**Never run live.** Written from Headroom's source, read and not executed: the `headroom-ai` 0.44.0 source distribution from PyPI (its sha256 checked against PyPI) and the repository at commit `9f2cc01` (2026-11-13). The launch script below was run once against a stand-in `headroom` that prints what it receives: the clean environment, the arguments, the refusals. The real proxy was not started, and no Claude Code session went through it. These are open, untested points:

- whether compressed content can be recovered without Headroom's MCP server and the session header that `headroom wrap` adds;
- how much is saved once offline mode runs on a cache warmed as described below;
- what Claude Code gives up behind a custom base URL (its documentation says Remote Control turns off);
- whether the Bash sandbox lets a session's commands reach the proxy's port;
- whether sending a subscription's OAuth token through a local third-party process fits that subscription's terms;
- whether a session that installs the kit relays the post-install steps without doing any of them, as `CLAUDE.md`, the post-install lines and the kit's installation skills ask.

The guard is tested on tables (`test/install.test.mjs` in the kit). Do the live check below once before relying on any of it.

## Why

Headroom sits between Claude Code and the model provider. Claude Code is pointed at it through `ANTHROPIC_BASE_URL`, and from then on the proxy receives every prompt, every file the session reads, every tool result, and the credential of every request: the API key, or the OAuth bearer of a subscription. That is what lets it compress. It is also exactly what a committed setting must never decide for everyone who clones the repository, and what a pull request must never be able to switch on.

Headroom's own installers go further than one session. `headroom wrap` and `headroom mcp install` register its MCP server at user scope, for every session on the machine. `headroom init` writes hooks and settings, and installs a plugin. `headroom learn` sends a digest of past transcripts to a model and writes what comes back into an instruction file. And by default the tool phones home: an anonymous beacon with a persistent install identifier, a daily update check, model downloads, and a poller that reads the subscription's credentials to query its usage.

So the kit keeps the stricter form. The repository holds this page, a guard, a `CLAUDE.md` bullet and a `.gitignore` block, and nothing that runs Headroom. A clone without Headroom, CI included, behaves exactly as before.

## Details

### When a session installs or updates the kit

The kit is often installed by a Claude Code session (`harness-init`, `harness-update`). For this module, that session runs the installer, which writes only this page, the guard, a `CLAUDE.md` bullet and a `.gitignore` block, and then stops. Everything below acts on a person's machine, outside the project: installing Headroom, saving the launch script, starting the proxy, starting `claude` through it. The installing session relays those steps in its hand-over and does none of them. It could not do the last one anyway: a session cannot restart itself through a proxy, so a person types the command that starts it.

If the person later asks a session on their own machine to help set Headroom up, the session follows this page step by step, shows each command before running it, and still never writes `ANTHROPIC_BASE_URL` into a settings file: a local settings file would send every session of the project on that machine through the proxy, which HR-1 cannot see because the file is not committed.

### What the proxy sees and keeps

Every request of a session launched through it, credential included, while the session runs. Started as below (`--stateless`), it keeps the originals of what it compressed in memory only: 30 minutes, at most 1000 entries, gone when it stops. Without `--stateless`, Headroom writes them by default to a SQLite store in its workspace (`ccr_store.db`: verbatim file contents and command outputs), along with its logs, and keeps them across restarts.

### Install

On your own machine, never in CI. Headroom needs Python 3.11 or later; the CLI ships only in the Python package (the npm package is a library without it).

```bash
uv tool install --python 3.13 'headroom-ai[proxy]==0.44.0' --exclude-newer 2026-11-13
```

- `==0.44.0` is the version this page was written against. Headroom releases often, about once a week: a newer version may rename the switches below. Re-read them before moving the pin.
- The `[proxy]` extra is what the proxy needs. `[all]` adds machine-learning stacks and integrations this setup does not use.
- The dependency tree is not hash-locked: many ranges are open-ended. `--exclude-newer` keeps it to what was uploaded before the date this page was checked.
- Hashes of the 0.44.0 files, from PyPI, to check a download by hand: source `4fa74895947905acc54564c1a24f67adefc71c2e4d1b599d723db46177f02e42`; macOS arm64 wheel `9b084f4cd9918af2d0970450ff3e990fffc29a8220dc5e24fa0f33a4dd0359cc`; macOS x86_64 `2ab9d0c7ced1b94220597b2a48996693ebc0a61dd1ce38749709ae299b3f51da`; Linux x86_64 `3b5c7fd289e7d227dcd9b896615541ea9d3d37388bd97b3257fc8769c4b7ef70`; Linux aarch64 `58f2e6ac736fe882f83cae0a3bffad7ce574d12587eb999d6501bffd053a75cd`; Windows `a7853a0d81f1e3f6d4b00de6114791732ff458c09b8af05a06c4ae2d8c492d68`.
- PyPI shows the release as published from the project's own release workflow at tag `v0.44.0` (trusted publishing). That attestation was decoded, not cryptographically verified.

### The launch script

Save this on your machine, outside the repository (for instance as `~/.local/bin/headroom-proxy`, made executable). It is personal machinery, like the install: nothing in the project calls it.

```sh
#!/bin/sh
# headroom-proxy [warm] — start the Headroom proxy from a clean environment.
set -eu
ws="$HOME/.headroom-claude"
mkdir -p "$ws"
chmod 700 "$ws"
if [ -e "$ws/settings.json" ]; then
  echo "headroom-proxy: $ws/settings.json exists — read it, delete it, then start again" >&2
  exit 1
fi
if ! command -v nc >/dev/null 2>&1; then
  echo "headroom-proxy: nc is needed to check that port 8787 is free" >&2
  exit 1
fi
if nc -z -w 1 127.0.0.1 8787 2>/dev/null || nc -z -w 1 ::1 8787 2>/dev/null; then
  echo "headroom-proxy: something already answers on port 8787 — find it before starting" >&2
  exit 1
fi
offline=1
if [ "${1:-}" = warm ]; then offline=0; fi
echo "headroom-proxy: PID $$"
exec env -i HOME="$HOME" PATH="$PATH" LANG="${LANG:-C.UTF-8}" \
  HEADROOM_WORKSPACE_DIR="$ws" HEADROOM_OFFLINE="$offline" \
  DO_NOT_TRACK=1 HEADROOM_BEACON=off HEADROOM_TELEMETRY=off HEADROOM_UPDATE_CHECK=off \
  headroom proxy --host 127.0.0.1 --port 8787 --backend anthropic --no-subscription-tracking --stateless
```

- **A clean environment.** `env -i` starts the proxy with only the variables listed, so nothing exported by a shell profile, a `.envrc` or a parent process reaches it (§ What the clean environment keeps out). Never add a variable to that list without reading what it does.
- **The settings file.** At every start, Headroom loads `settings.json` from its workspace and uses each value the environment does not set. The proxy also rewrites that file on a plain HTTP request from the machine: a request without an `Origin` header, such as `curl -X POST http://127.0.0.1:8787/settings`, is accepted. The first things such a request can change are the upstream URL and extra headers sent with every forwarded request, then an upstream proxy, the bind address and message logging. So a session that can reach the port could reconfigure the next start of the proxy that holds its credentials. A dedicated workspace, private to you, whose file is checked before each start, closes that. The flags on the command line win over the file for what they set.
- **The switches.** `HEADROOM_OFFLINE=1` refuses every connection Headroom itself decides to make: the beacon, the update check, model downloads, the pricing refresh, the pollers. It still forwards your requests to the provider. The other switches are there in case one is mistyped, since the beacon is on unless a value it recognises turns it off. In order, the first that matches wins: offline mode, `DO_NOT_TRACK`, `HEADROOM_BEACON`, then `HEADROOM_TELEMETRY` (only its off values). Offline mode does not cover tiktoken's vocabulary download, which only has a timeout.
- **`--stateless`** keeps the store of compressed originals, the savings ledger and the logs in memory (§ What the proxy sees and keeps). It does not stop a request to `/settings` from writing `settings.json`: the check above stays needed.
- **The port.** The script refuses to start if anything already answers on port 8787, and if `nc` is missing. It needs a netcat with `-z`, as macOS and `netcat-openbsd` have; one without `-z` would let the check pass, so check yours once. This was exercised on macOS only. `headroom proxy` itself only refuses 127.0.0.1:8787 when that exact address is bound; on macOS it starts next to a listener on `0.0.0.0` or `::1`, which would then receive the session's requests, credential included, if the proxy stopped.

### Warm the model cache once

In offline mode Headroom uses only models already in its cache; with an empty cache, the compressors that need a model cannot load and the savings may be small. Run `headroom-proxy warm` once: the same start, online, with the beacon, the update check and the subscription poller still off. Headroom loads its models when it starts; once its log says they are loaded, stop it. They come from Hugging Face, pinned by commit for the models Headroom ships with; `HEADROOM_HF_PIN=off` would drop those pins. Whether one online start fetches every model the proxy later needs has not been checked: on the next offline start, look for a model that fails to load.

### Start a session

With the proxy running in its own terminal, in the terminal of the session:

```bash
lsof -nP -iTCP:8787 -sTCP:LISTEN
```

It must show exactly one line, on `127.0.0.1:8787`, with the PID the script printed. Then:

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:8787 ENABLE_TOOL_SEARCH=true claude
```

- **Only that process.** The two variables are given to one `claude` process, never exported in a shell profile and never put in a settings file. Another session on the machine goes straight to the provider.
- **`ENABLE_TOOL_SEARCH=true`.** Claude Code versions before 2.1.304 turned MCP tool search off behind a custom base URL; this keeps it on for them. Later versions keep it on by default, and may still fall back without it after an error from the proxy.
- **Reaching the port from the session.** From inside the session, `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/health` must fail. If it succeeds, the session can change the running proxy too, not only its next start: `POST /admin/runtime-env` hot-reloads how the proxy shapes requests, with no `Origin` header needed. The settings check guards only the next start. If that matters to you, end the session and restart the proxy from the script, and keep `127.0.0.1:8787` out of what the Bash sandbox lets commands reach.

### What the clean environment keeps out

`env -i` drops all of these; each one, set for the proxy, sends content or credentials somewhere else, writes prompts to disk, or weakens a pin. The ones marked with a star can also be set through `settings.json`, which is why the script checks it.

| Variable | What it would do |
|---|---|
| `ANTHROPIC_TARGET_API_URL`\*, `ANTHROPIC_FOUNDRY_BASE_URL`, `ANTHROPIC_TARGET_API_HEADERS`\* | send the requests and their credential to another upstream, or add headers to every forwarded request |
| `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `HEADROOM_HTTP_PROXY`\*, `HEADROOM_BACKEND`\* other than `anthropic`, `HEADROOM_ANYLLM_PROVIDER`\* | send the traffic through another proxy or to another provider |
| `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`, `HEADROOM_CA_BUNDLE`, `HEADROOM_CERT_STORE`, `NODE_EXTRA_CA_CERTS` | change which certificate the upstream connection accepts |
| `HEADROOM_HOST`\* off loopback, `HEADROOM_ALLOW_UNAUTHENTICATED_BIND`, `HEADROOM_UDS`\* | expose the proxy beyond this user |
| `HEADROOM_LOG_FILE`\*, `HEADROOM_LOG_MESSAGES`\*, `HEADROOM_DEBUG_DUMP`, `HEADROOM_CCR_BACKEND`, `HEADROOM_COMPRESS_SESSION_STORE`, `HEADROOM_REDIS_URL` | write prompts and responses to disk, or send the store of originals to a server |
| `HEADROOM_PROXY_EXTENSIONS`\* | load extra code into the proxy |
| `HEADROOM_SETTINGS_PATH`, `HEADROOM_CONFIG_DIR` | read settings or configuration from another place than the checked workspace |
| `HEADROOM_CC_SWITCH_RECONCILE` | let the proxy rewrite `~/.claude/settings.json` and take its upstream from it |
| `HEADROOM_HF_PIN=off`, `HEADROOM_BINARIES_ALLOW_UNVERIFIED`, `HF_HUB_OFFLINE=0`, `TRANSFORMERS_OFFLINE=0` | drop the model pins, accept unverified binaries, or reopen downloads under offline mode |
| `HEADROOM_TELEMETRY_ENDPOINT`, `HEADROOM_KOMPRESS_ENDPOINT`, `HEADROOM_LICENSE`, `HEADROOM_API_KEY` | send data to another endpoint, or switch on a hosted service |

### Left out

| Headroom feature | What it writes or sends | Why not here |
|---|---|---|
| `headroom wrap claude` | registers its MCP server at user scope in `~/.claude.json`, for every session; edits user settings on its first run and on `unwrap`; with options, `.claude/settings.local.json`, a hook, sidecar files, a `.headroom/` memory store, a block in `CLAUDE.md` | wider than one session, and harder to undo completely |
| `headroom init` | hooks and an `ANTHROPIC_BASE_URL` in settings, a plugin, the MCP server | the same, plus a hook in every session |
| `headroom mcp install` | its MCP server, at user scope, in every coding agent it detects on the machine | every session of every agent gets it |
| the `headroom-marketplace` plugins | hooks on session start and on every Bash call, a status line | code running in every session |
| `headroom learn` | a transcript digest sent to a model; the result written to `CLAUDE.local.md` or, on request, `CLAUDE.md` | transcripts leave the machine; the result instructs future sessions |
| the Docker image | a root process by default; signatures not pullable anonymously | more moving parts for the same proxy |

If you used any of them anyway, the undo is longer than the one below: `headroom unwrap claude`, `headroom mcp uninstall` (it removes the server from every agent it detects), then check `~/.claude.json`, `~/.claude/settings.json` and the project's `.claude/settings.local.json` by hand.

### Undo

Stop the proxy. Then:

```bash
uv tool uninstall headroom-ai
```

Delete `~/.headroom-claude`, `~/.headroom` and the launch script. The models downloaded during the warm-up stay in the Hugging Face cache (`~/.cache/huggingface` by default) until you delete them.

### Not for every project

HR-1 has no exception, and it reads every committed file. A project cannot keep this module green if it commits:

- a deliberate gateway (`ANTHROPIC_BASE_URL` or another `*_BASE_URL` in `.claude/settings.json`);
- a proxy variable in any workflow or action, whatever the job does: `HTTPS_PROXY` for `npm ci` on a corporate runner fails as surely as one for a Claude session;
- the word `headroom` in any file but Markdown prose, whatever it means there: a dependency on an unrelated library of that name, "memory headroom" in a code comment, a project whose own name holds the word (the kit writes the project's name into some files);
- port 8787 written on its own, wherever it appears: it is also the default port of other development servers, such as `wrangler dev`.
- a binary file (an image, an archive) whose bytes happen to spell either one: rare, but binaries are read too, since a hook can run a compiled program.

A guard of its own cannot turn HR-1 green: the gate fails on any failing guard. Such a project either does not install this module, or edits `scripts/guards.d/48-headroom.sh` deliberately, in a reviewed change, and accepts the drift note `update` and HD-1 then report on that file.

### What the guard does not see

HR-1 reads every committed file, as committed, and matches names: `headroom`, port 8787 on its own, and, in settings files, workflows and composite actions, the variables that reroute traffic. It does not see:

- what is not in the repository: a submodule's files, a file stored with Git LFS (only its pointer is committed), a plugin a marketplace fetches from elsewhere (GitHub, a git URL, npm), a file over 20 MB (listed in a note), user and managed settings;
- a name built at run time (`echo "ANTHROPIC_${X}=…" >> "$GITHUB_ENV"`, `printf %b`, a GitHub expression such as `format()`), or spelled in an encoding other than UTF-8, UTF-16 and the escapes it decodes;
- a route variable for another host outside settings files, workflows and actions: an `ANTHROPIC_BASE_URL` towards a gateway in `.envrc`, a devcontainer or a script passes, as long as it does not name Headroom or port 8787;
- Markdown prose, which instructs rather than runs: a skill or a command that tells a session to start Headroom is refused by the `CLAUDE.md` rule and by review, not by this check. The frontmatter of Markdown files is read, where an agent's or a skill's hooks, servers and allowed tools are declared, and so is any Markdown file holding dynamic shell context;
- a port written in another form: another base (`0x2253`), a name that resolves to the loopback address, a port computed at run time;
- a file name that a case-insensitive filesystem folds onto another through a character other than U+017F and U+212A, or through Unicode normalisation;
- a proxy on another port under another name.

### Live check

On the machine where Headroom runs, in a scratch project:

1. Start the proxy with the script, then the session. Ask the session for a long file read: the proxy's log must show a request compressed, and the session must answer.
2. In the session, ask for `curl -s http://127.0.0.1:8787/health` from Bash. Note whether it succeeds (§ Status).
3. Stop the proxy with the session open: the session's next request must fail, never fall back silently.
4. Commit a `.claude/settings.json` holding `{"env": {"ANTHROPIC_BASE_URL": "http://127.0.0.1:8787"}}` and run `./scripts/security-checks.sh`: HR-1 must fail.

## Checks

`scripts/guards.d/48-headroom.sh`:

- **HR-1** — what is committed neither names, runs nor reaches Headroom, nor reroutes a session. It reads the blobs of the index, what GitHub runs and a clone gets, not the bytes on this disk (a `.gitattributes` encoding or a sparse checkout changes nothing):
  - **Every committed file**: no `headroom`, and no port 8787 unless it is part of a longer number or word (`18787`, `v1.8787`, a hash). Each file is read as UTF-8 with NUL bytes dropped (so UTF-16 reads too), lines continued by a backslash joined (after LF, CR, U+0085, U+2028 or U+2029), and `\u`, `\x`, `\U` and octal escapes decoded; a symlink is read as the path it points to. Markdown is read in its frontmatter only, up to the first line of three dashes, and whole when it holds the dynamic shell context Claude Code runs itself in a command or a skill (an exclamation mark before a backquoted span, or a fenced block opened with one). This guard, `.gitignore` and `.claude/harness.json`, which name the module, are skipped.
  - **Settings files** (`.claude/settings.json`, at any depth), read as JSON: no `ANTHROPIC_*BASE_URL`, `ANTHROPIC_CUSTOM_HEADERS`, `HTTP_PROXY`, `HTTPS_PROXY` or `ALL_PROXY` in `env`, whatever the host; the names above anywhere but `permissions.deny` and `permissions.ask`, which may name Headroom to keep it out (`permissions.allow` may not pre-approve it). A settings file that is not JSON fails.
  - **Workflows and composite actions** (`action.yml`): no line naming one of those variables, comments included. No `\x`, `\u`, `\U` or octal escape spelling a letter, a digit or `_`. No NUL byte and no U+0085, U+2028 or U+2029: GitHub reads them as UTF-16 or as line breaks.
  - `.claude`, `.mcp.json`, `.github`, `action.yml`, `.claude-plugin` and `hooks/hooks.json` are never a symlink or a submodule. No tracked path holds `ſ` (U+017F) or `K` (U+212A), which macOS and Windows fold onto `s` and `k`.
  - The project is the repository's root: installed in a sub-directory, the root's settings and workflows would go unchecked, so that fails.
- **HR-2** — `.headroom/`, the `.claude/.headroom_wrap_*` files, `.claude/settings.local.json` and `CLAUDE.local.md` are not tracked, at any depth and in any case, and the module's `.gitignore` block is still there.
- **HR-3** — no block written by `headroom learn` (its opening `headroom:learn:start` comment) in any committed file, this page included.

HR-1 needs Node. Without it, HR-2 and HR-3 still run, then the guard skips locally and fails on a runner. Outside a git repository nothing is committed to read: a note locally, a failure on a runner.

## Sources

- [headroomlabs-ai/headroom](https://github.com/headroomlabs-ai/headroom), Apache License 2.0. Read on 2026-11-13: the `headroom-ai` 0.44.0 source distribution from PyPI (tag `v0.44.0`, commit `b21479e`), and the repository at commit `9f2cc01`. What was taken: command names, flags, environment variables and the behaviour described on this page, read in its code. No text or code was copied.
- [Claude Code environment variables](https://code.claude.com/docs/en/env-vars) and [MCP tool search](https://code.claude.com/docs/en/mcp), read on 2026-11-13: the variables that move a session's API traffic (`ANTHROPIC_BASE_URL` and the provider-specific `*_BASE_URL`, `ANTHROPIC_CUSTOM_HEADERS`, `HTTP_PROXY`, `HTTPS_PROXY`), `ENABLE_TOOL_SEARCH` behind a gateway, and Remote Control turning off behind a custom base URL.

## History

- Installed with the kit.
