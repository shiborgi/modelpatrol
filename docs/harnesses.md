# Central harness adapters

ModelPatrol runs a single HTTP gateway. Subscription-backed CLIs are internal,
registered adapters; they do not open provider-specific ports or expose local
OAuth sessions. The closed provider configuration selects one with:

```json
{
  "auth": "none",
  "transport": {
    "kind": "harness",
    "adapter": "codex",
    "workspaceEnv": "MODELPATROL_CODEX_WORKSPACE"
  },
  "plan": { "kind": "subscription", "name": "ChatGPT Codex" }
}
```

The built-in adapter IDs are `codex`, `claude`, `opencode`, `grok` and
`antigravity`. Every adapter exposes the same internal methods:
`capabilities()`, `invoke()`, `getUsage()` and `health()`. Invocation is
bounded and uses either the configured absolute workspace or a fresh temporary
directory. Every local adapter exposes native Chat streaming: Codex consumes
app-server agent-message deltas, Claude consumes partial `stream-json`, OpenCode
consumes `run --format json` NDJSON over stdio, Grok consumes streaming Messages NDJSON,
and Antigravity consumes `stream-json`. Ollama is an HTTP provider and its SSE is
passed through unchanged. The gateway timeout bounds every harness process and is
also passed to Antigravity's `--print-timeout`. Chat requests that include
function tools pass a simplified structured-output schema through the CLI where
supported; transports such as OpenCode that cannot return native function calls
receive the same exact-JSON contract in the prompt. Adapters prefer authoritative
terminal structured output over prose wrappers and run
Antigravity headless with `--dangerously-skip-permissions`, `--new-project` and
`--add-dir`. An absolute
`x-patrol-workspace` header (CodePatrol stage worktree) is the cwd; without it,
schema-constrained turns use a temporary directory instead of the operator project.
Review and ship steps require `approved` in that schema. Unknown quotas remain
`null`; adapters never infer a limit that the provider did not disclose.

CodePatrol build stages select each CLI's edit-capable mode and remain confined to
the isolated stage worktree. Every other stage uses a read-only or plan mode.
Reasoning, tool inputs and tool outputs are never translated into visible Chat
content. A terminal mismatch, truncated stream, cancellation or timeout fails the
request without replaying it through another provider.

Direct HTTP providers use `transport.kind: "http"` (the default). An HTTP
provider may select a separate account reader through `usageAdapter`; Ollama is
the built-in example. All account data is normalized through
`GET /admin/providers/:id/usage`.

With the local gateway running, validate real incremental delivery for the five
CodePatrol candidates with `npm run smoke:streaming`. The command is deliberately
separate from `npm test` because it uses authenticated subscription/API quota. It
requires multiple content deltas from partial-text harnesses and at least one
completed text part from OpenCode, plus the terminal finish event and `[DONE]`
marker for every model. Pass model IDs after `--` to test a subset.
OpenCode 1.x can publish a completed assistant text part rather than token-sized
deltas; the gateway forwards it immediately and CodePatrol heartbeats keep the
stage observable while the CLI is silent. ModelPatrol does not start a private
OpenCode listener to obtain finer events.

The ModelPatrol gateway secret authenticates inference clients. Provider API
keys and CLI sessions remain local and are never stored in request telemetry.
