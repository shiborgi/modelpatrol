# Changelog

## 1.0.0

- Stream Codex app-server, Claude `stream-json`, OpenCode `run --format json` NDJSON, Grok Messages NDJSON and Antigravity `stream-json` as native Chat SSE without provider-specific listeners; preserve terminal structured output and usage, honor the gateway timeout, and run CodePatrol build stages in edit-capable modes.
- Require `approved` in Antigravity/Grok structured output for CodePatrol review and ship steps.
- Bind local Chat harness cwd to CodePatrol's `x-patrol-workspace` worktree (`--new-project` / `--add-dir` for Antigravity) instead of the operator subscription project.
- Pass Chat function-tool schemas to Grok and Antigravity as a simplified `--json-schema` file and constrain OpenCode with the same exact-JSON contract in its prompt; prefer `structured_output` over CLI prose, and skip Antigravity headless permission prompts so plan-mode reads can finish a CodePatrol result.
- Record a sanitized gateway validation reason on failed inference events and responses, without persisting raw provider errors.
- Align the Pi adapter context window with the Chat routing pool (64K/4K, overridable) so tool follow-ups are not truncated to a 32K remainder.
- Expose every local subscription harness through the unified Chat contract so `model=auto` can select Codex, Claude, OpenCode, Grok, Ollama or Antigravity for a CodePatrol request.

- Document global CodePatrol Pi package installation and the interactive `/patrol` entry point.

- Organize OpenCode and Pi integrations as independent harness modules.
- Expose `modelpatrol integration-path` for portable executor discovery.
- Preserve the completed-response SSE bridge only as a compatibility path for adapters without a native stream.

- Add independent Patrol gateway with explicit and metadata-driven model routing.
- Add native Chat Completions, Responses and Messages transport with SSE accounting.
- Add five provider presets, plan metadata, SQLite usage history and local dashboard.
- Add budgets, rate/concurrency controls, exact caching and bounded fallback.
- Add OpenCode/Pi transport adapters and optional CodePatrol stage environment integration.
- Provide one centralized gateway process with modular in-process harness adapters
  for Codex, Claude, OpenCode, Grok and Antigravity subscription limits.
- Document the harness contract and full Helicone parity gaps explicitly.

There is no prior public version, migration path, legacy runtime, or compatibility mode.
