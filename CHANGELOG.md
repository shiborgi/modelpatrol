# Changelog

## 1.0.0

First release of ModelPatrol. Requires Node.js 22 or newer.

- Local OpenAI- and Anthropic-compatible proxy that routes by intent
  (`spec`, `plan`, `build`, and the rest of the CodePatrol golden path).
- Built-in coding-plan catalog: Codex, z.ai, Alibaba token plan, SuperGrok,
  OpenCode Go, Kimi, and Antigravity.
- JSONL ledger with rolling 5-hour, 7-day, and 30-day windows for calls,
  tokens, and estimated spend, per plan and globally.
- CLI: `init`, `doctor`, `start`, `stop`, `status`, `usage`, `resolve`, `env`.
- Drop-in base URL for Pi, OpenCode, and CodePatrol harnesses.
