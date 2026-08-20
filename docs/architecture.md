# Architecture

ModelPatrol is a local HTTP proxy plus a JSONL ledger. There is no database
and no remote control plane.

```
CLI
  -> load config (~/.modelpatrol/config.json)
  -> start HTTP server (127.0.0.1:4200)

inbound OpenAI / Anthropic request
  -> extract intent (header > query > model name > default)
  -> resolve plan + model
  -> evaluate 5h / 7d / 30d windows
  -> translate protocol if needed
  -> forward to the coding-plan base URL
  -> record ledger event
  -> rewrite the response model back to the inbound intent
```

## Authority

- `~/.modelpatrol/config.json` is the mapping of intents to plans.
- `~/.modelpatrol/ledger.jsonl` is the append-only usage log.
- Environment variables hold plan API keys. They are never written to disk
  by ModelPatrol.

## Intent

An intent is a stable id, not a model name. CodePatrol stages are first-class
intents: `spec`, `spec-review`, `plan`, `plan-review`, `build`,
`build-review`, `ship`. Additional ids can be added in config.

Resolution order:

1. `x-modelpatrol-intent`
2. `?intent=`
3. `body.model` when it matches a configured intent
4. `defaultIntent`

## Plans

A plan is a subscription or token pool with one protocol (`openai` or
`anthropic`), one `baseUrl`, and one or more auth environment names. Built-in
ids: `codex`, `zai`, `alibaba`, `supergrok`, `opencode-go`, `kimi`,
`antigravity`.

## Windows

Windows are rolling, not calendar-aligned:

| Id        | Length   |
| --------- | -------- |
| fiveHour  | 5 hours  |
| week      | 7 days   |
| month     | 30 days  |

A snapshot is computed from the ledger at request time. Caps may `warn` or
`block`. A blocked request is recorded with status 429 and does not call the
upstream plan.

## Integrity

- The ledger never stores prompts.
- Estimated `costUsd` uses the config price table. Missing prices are zero.
- Corrupt ledger lines are skipped.
- The proxy binds loopback unless `host` is changed.
