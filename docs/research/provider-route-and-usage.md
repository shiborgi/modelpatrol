# Research — provider/model/level routing and provider usage windows

## Request

Operators want inbound routing by **provider**, **model**, and **level**
(`default`, `high`, `max`, …) instead of a CodePatrol intent id. They also
want:

- a CLI that lists every known provider and model
- a CLI that, given a provider, reports 5h / week / month usage **from the
  provider** when those windows exist

This wave's catalog is:

| Provider | Models |
| -------- | ------ |
| xAI | `grok-4.6`, `grok-build-0.1` |
| OpenAI | `gpt-5.6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra` |

## Level

Level is reasoning effort, not a model id.

- OpenAI reasoning models accept `reasoning_effort` / `reasoning.effort`
  values such as `none`, `low`, `medium`, `high`, and `xhigh`.
- xAI documents `reasoning_effort` on some Grok models (`none`, `low`,
  `medium`, `high`). Grok 4.6 public notes also mention `xhigh`.

ModelPatrol maps a small operator vocabulary onto those values:

| Level | OpenAI | xAI |
| ----- | ------ | --- |
| `default` | omit (provider default) | omit |
| `high` | `high` | `high` |
| `max` | `xhigh` | `xhigh` if the model advertises it, else `high` |

Unknown levels are `USAGE`.

## Official model ids

- xAI docs list `grok-4.6` and `grok-build-0.1` (docs.x.ai/docs/models).
- GPT-5.6 family public names Sol / Terra / Luna are treated as API ids
  `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`. If the live catalog
  differs, the built-in table is the source of truth for this wave.

## Provider usage windows

Consumer coding-plan UIs (ChatGPT/Codex, SuperGrok) historically expose
rolling 5h and weekly caps. Those are **not** the same as the pay-as-you-go
API:

- OpenAI API: RPM / TPM / RPD via rate-limit headers and the organization
  usage API (`/v1/organization/usage/...`). No public 5-hour subscription
  window on a standard API key.
- xAI API: RPM / TPM by spend tier in the console. No documented public
  endpoint that returns SuperGrok 5h / 7d / 30d remaining quota.

Therefore `usage --provider` must:

1. Call an injectable provider adapter.
2. Return each of `fiveHour`, `week`, `month` with either numbers or
   `available: false` and a reason.
3. Never invent a window the provider did not return.
4. Still leave the existing local ledger `usage` command intact.

Adapters in this wave:

- **openai** — GET organization usage (completions) when an admin-capable
  key is present; map bucketed usage into week/month when the API returns
  those ranges. fiveHour is `available: false` unless the response includes
  an equivalent window.
- **xai** — GET any documented usage/limits path; if none exists or the
  response has no matching window, every requested window is
  `available: false` with `reason: "unsupported"`.

Tests never call live OpenAI or xAI; HTTP is injected.

## Compatibility

Existing CodePatrol harnesses still send intent model names (`build`,
`spec`, …). Intent resolution stays as a fallback after provider/model
headers and `provider/model` slugs so those harnesses keep working.

## Sources

- https://docs.x.ai/docs/models (`grok-4.6`, `grok-build-0.1`)
- https://docs.x.ai/docs/api-reference (`reasoning_effort`)
- OpenAI organization usage API and rate-limit headers
- OpenAI GPT-5.6 Sol / Terra / Luna public naming
