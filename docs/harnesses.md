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
non-streaming, runs in plan/read-only mode and uses either the configured
absolute workspace or a fresh temporary directory. Unknown quotas remain
`null`; adapters never infer a limit that the provider did not disclose.

Direct HTTP providers use `transport.kind: "http"` (the default). An HTTP
provider may select a separate account reader through `usageAdapter`; Ollama is
the built-in example. All account data is normalized through
`GET /admin/providers/:id/usage`.

The ModelPatrol gateway secret authenticates inference clients. Provider API
keys and CLI sessions remain local and are never stored in request telemetry.
