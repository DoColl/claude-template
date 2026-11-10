#!/usr/bin/env node
// PreToolUse hook on Bash for the read-only / verification sub-agents — CLI.
// Agent frontmatter: node "$CLAUDE_PROJECT_DIR/.claude/hooks/agent-bash-guard.mjs" <readonly|verify> || exit 2
// Exit 0 allows, exit 2 blocks (the only code Claude Code blocks on); every
// failure path, here and in the `|| exit 2`, is a block. Logic: the -lib file.
import fs from "node:fs";
import { decide, normalizeConfig, EMPTY_CONFIG } from "./agent-bash-guard-lib.mjs";

// The project's verification commands. A missing or invalid file never widens
// anything: the verify profile then allows the read-only shapes only.
function loadConfig() {
  try { return { config: normalizeConfig(JSON.parse(fs.readFileSync(new URL("./agent-bash-guard.config.json", import.meta.url), "utf8"))) }; }
  catch (e) { return { config: EMPTY_CONFIG, problem: e.code === "ENOENT" ? "agent-bash-guard.config.json is missing" : `agent-bash-guard.config.json is invalid: ${e.message}` }; }
}

try {
  const profile = process.argv[2];
  const payload = JSON.parse(fs.readFileSync(0, "utf8"));
  if (payload.tool_name && payload.tool_name !== "Bash") process.exit(0);
  const { config, problem } = profile === "verify" ? loadConfig() : { config: EMPTY_CONFIG };
  const v = decide(payload.tool_input?.command, profile, config);
  if (v.allow) process.exit(0);
  process.stderr.write(`agent-bash-guard[${profile}]: blocked — ${v.reason}.${problem ? ` Note: ${problem}, so no verification command is available.` : ""} Report the need instead of working around it (docs/conventions/agent-bash-guard.md).\n`);
  process.exit(2);
} catch (e) {
  process.stderr.write(`agent-bash-guard: blocked — hook error (${e?.message ?? e}); failing closed.\n`);
  process.exit(2);
}
