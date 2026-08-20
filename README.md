# ModelPatrol

Local-first LLM proxy that routes each call by **intent** and tracks spend
across coding plans.

Harnesses such as Pi and OpenCode send an intent (`spec`, `plan`, `build`,
and the rest of the CodePatrol golden path). ModelPatrol maps that id to a
pre-configured coding plan and model, forwards the request, and records
tokens, calls, and estimated cost in rolling **5-hour**, **7-day**, and
**30-day** windows.

```
Pi / OpenCode / CodePatrol
        |
        |  model = "build"   or   x-modelpatrol-intent: build
        v
   ModelPatrol :4200
        |
        +-- spec          -> Kimi
        +-- spec-review   -> Codex
        +-- plan          -> Kimi
        +-- plan-review   -> SuperGrok
        +-- build         -> Codex
        +-- build-review  -> SuperGrok
        +-- ship          -> OpenCode Go
```

There is no cloud account. Config and the JSONL ledger live under
`~/.modelpatrol`.

## Commands

```
modelpatrol init
modelpatrol doctor
modelpatrol start
modelpatrol start --detach
modelpatrol stop
modelpatrol status
modelpatrol usage
modelpatrol resolve --intent build
modelpatrol env --intent spec
modelpatrol --help
modelpatrol --version
```

## Quick start

```bash
npm ci
npm run verify

modelpatrol init
# export CODEX_API_KEY / MOONSHOT_API_KEY / XAI_API_KEY / ...
modelpatrol doctor
modelpatrol start --detach

eval "$(modelpatrol env --intent build)"
# point Pi or OpenCode at OPENAI_BASE_URL / ANTHROPIC_BASE_URL
```

`modelpatrol env --intent spec` prints:

```bash
export OPENAI_BASE_URL=http://127.0.0.1:4200/v1
export ANTHROPIC_BASE_URL=http://127.0.0.1:4200
export OPENAI_API_KEY=modelpatrol
export ANTHROPIC_API_KEY=modelpatrol
export MODELPATROL_INTENT=spec
```

CodePatrol then starts a stage with the intent as `--model`:

```bash
codepatrol spec start --initiative INIT-1 --todo todo.json \
  --harness opencode --model spec
```

## Intent mapping

The inbound model name is the intent when it matches a configured id. A
header wins if both are present:

- `x-modelpatrol-intent: plan`
- `x-modelpatrol-harness: opencode`

Default map (edit `~/.modelpatrol/config.json`):

| Intent        | Plan        | Model           |
| ------------- | ----------- | --------------- |
| spec          | kimi        | kimi-k2.5       |
| spec-review   | codex       | gpt-5.3-codex   |
| plan          | kimi        | kimi-k2.5       |
| plan-review   | supergrok   | grok-4          |
| build         | codex       | gpt-5.3-codex   |
| build-review  | supergrok   | grok-4          |
| ship          | opencode-go | gpt-5.3-codex   |

## Coding plans

| Id           | Label              | Auth env                          |
| ------------ | ------------------ | --------------------------------- |
| codex        | OpenAI Codex       | `CODEX_API_KEY` / `OPENAI_API_KEY` |
| zai          | z.ai Coding Plan   | `ZAI_API_KEY`                     |
| alibaba      | Alibaba Token Plan | `DASHSCOPE_API_KEY`               |
| supergrok    | SuperGrok          | `XAI_API_KEY`                     |
| opencode-go  | OpenCode Go        | `OPENCODE_API_KEY`                |
| kimi         | Kimi               | `MOONSHOT_API_KEY`                |
| antigravity  | Antigravity        | `ANTIGRAVITY_API_KEY`             |

Base URLs and models are config, not code.

## Windows

`modelpatrol usage` and `GET /v1/usage` aggregate the ledger into:

- `fiveHour` — 5 hours
- `week` — 7 days
- `month` — 30 days

Each window reports calls, tokens, and estimated USD, globally and split by
plan and intent. Caps in config can `warn` (header) or `block` (HTTP 429).

`costUsd` is list-price arithmetic so subscription plans stay comparable. It
is not an invoice.

## HTTP

- `GET /health`
- `GET /v1/status`
- `GET /v1/usage`
- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/messages`

OpenAI and Anthropic inbound bodies are translated to the plan's protocol.

## Configuration

`modelpatrol init` writes `~/.modelpatrol/config.json`. Override the home
with `--home` or `MODELPATROL_HOME`. Override the file with
`MODELPATROL_CONFIG`.

Window caps:

```json
{
  "windows": {
    "fiveHour": { "maxTokens": 2000000, "onExceed": "warn" },
    "week": { "maxCostUsd": 40, "onExceed": "warn" },
    "month": { "maxCostUsd": 120, "onExceed": "block" }
  }
}
```

## License

MIT.
