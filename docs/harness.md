# Harness integration

ModelPatrol is a drop-in OpenAI and Anthropic base URL. The harness keeps
talking to a single local endpoint; ModelPatrol picks the coding plan.

## Shared environment

```bash
modelpatrol start --detach
eval "$(modelpatrol env --intent build)"
```

That sets `OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL`, dummy API keys, and
`MODELPATROL_INTENT`.

## CodePatrol

Pass the intent as `--model`. CodePatrol records it on the attempt; the
harness sends it as the OpenAI/Anthropic model name.

```bash
eval "$(modelpatrol env --intent spec)"
codepatrol spec start --initiative INIT-1 --todo todo.json \
  --harness opencode --model spec

eval "$(modelpatrol env --intent build)"
codepatrol build start --wave WAVE-1.1 --todo todo.json \
  --harness opencode --model build
```

Optional: send `x-modelpatrol-harness: opencode` so usage splits by harness.

## OpenCode

Point the provider base URL at the proxy. Use the intent as the model:

```json
{
  "model": "spec",
  "provider": {
    "modelpatrol": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://127.0.0.1:4200/v1",
        "apiKey": "modelpatrol"
      }
    }
  }
}
```

Or export `OPENAI_BASE_URL=http://127.0.0.1:4200/v1` before launching
`opencode`.

## Pi

```bash
export OPENAI_BASE_URL=http://127.0.0.1:4200/v1
export ANTHROPIC_BASE_URL=http://127.0.0.1:4200
pi --model plan
```

## Headers

| Header                 | Meaning                          |
| ---------------------- | -------------------------------- |
| `x-modelpatrol-intent` | Force the intent id              |
| `x-modelpatrol-harness`| Label the caller (`pi`, `opencode`) |

Response headers echo the route: `x-modelpatrol-plan`,
`x-modelpatrol-model`, `x-modelpatrol-warnings`.
