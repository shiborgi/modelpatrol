# Providers and plans

Each provider has an explicit endpoint, an environment-variable credential
reference, an authentication scheme and a billing plan. Presets are convenience
defaults; the operator owns account access, model IDs and prices.

| Preset | Credential | Transport |
| --- | --- | --- |
| `anthropic` | `ANTHROPIC_API_KEY` | Anthropic Messages; limited OpenAI SDK compatibility |
| `codex` | `OPENAI_API_KEY` | OpenAI Responses for Codex-capable API models |
| `ollama-cloud` | `OLLAMA_API_KEY` | Ollama Cloud OpenAI-compatible API |
| `grok` | `XAI_API_KEY` | xAI compatible API |
| `opencode` | `OPENCODE_API_KEY` | OpenCode Zen, model-specific Chat/Responses/Messages |

`plan: {kind: "subscription", name: "My plan", monthlyUsd: 20}` records a
contracted fixed fee; it does not grant authentication or imply unlimited
usage. That monthly amount is illustrative. `kind: "metered"` enables token
price estimates if rates and usage are known. Rates are never fetched or
silently updated. Configure cache-read/write rates where applicable.

**Codex/ChatGPT and Claude consumer subscriptions are not generic API keys.**
The Codex preset uses OpenAI Platform API billing, not ChatGPT plan credits.
Do not copy CLI session tokens into API-key fields. Use a central harness
transport when a provider-supported CLI owns the interactive login, token
renewal and quotas; see [central harness adapters](harnesses.md). Ollama Cloud direct API
keys can be used with the operator's cloud plan. OpenCode here means the Zen
provider, distinct from the OpenCode execution harness.

Models expose explicit `apis`, `capabilities`, `contextWindow`,
`maxOutputTokens`, `quality` and optional `pricing`. This prevents a rule from
routing native tool/thinking formats into incompatible providers. There is no
cross-format conversion layer or discovery of private account entitlements.

## Official references consulted

- [OpenAI/Codex authentication](https://learn.chatgpt.com/docs/auth): API billing and ChatGPT credits are separate.
- [Anthropic OpenAI SDK compatibility](https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk): compatibility limitations.
- [Ollama authentication](https://docs.ollama.com/api/authentication) and [OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility).
- [xAI Chat Completions](https://docs.x.ai/developers/model-capabilities/legacy/chat-completions).
- [OpenCode Zen](https://opencode.ai/docs/zen/): provider endpoints differ by model.
- [OpenCode plugin hooks](https://github.com/anomalyco/opencode/blob/dev/packages/plugin/src/index.ts).
- [Pi custom providers](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/custom-provider.md).

Checked September 7, 2026. Account-specific availability and live calls were
not verified with user credentials.
