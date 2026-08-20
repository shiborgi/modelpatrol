# INIT-2 — Provider, model, and level routing

Recorded on CodePatrol as Initiative `INIT-2`, Waves `WAVE-2.1` and `WAVE-2.2`.

## Intent

Let an operator address a model by **provider**, **model**, and **level**
instead of a CodePatrol intent id. The CLI lists the catalog. A second
command asks a provider for 5h / week / month usage and reports only
windows the provider actually returns.

## Operator flow

```text
modelpatrol catalog
# lists xai and openai providers, base URLs, models, and per-level reasoning

# harness / client sends:
#   x-modelpatrol-provider: xai
#   x-modelpatrol-model: grok-4.6
#   x-modelpatrol-level: high
# or body.model = "xai/grok-4.6"

modelpatrol usage --provider xai
# { provider, windows: { fiveHour, week, month } }
# a window is either populated or { available: false, reason }
```

## Classification

Structural: inbound identity changes from Intent to Provider + Model +
Level. Intent remains a compatibility fallback.

## Wave 2.1 — Catalog and routing

### WORK-2.1.1 Built-in catalog

Ship a static catalog for this wave only. Each provider carries exactly one
base URL and one credential seam, so forwarding and `resolve` have a
single verifiable source.

- **a1** Catalog includes provider `xai` with models `grok-4.6` and
  `grok-build-0.1`.
- **a2** Catalog includes provider `openai` with models `gpt-5.6-luna`,
  `gpt-5.6-sol`, and `gpt-5.6-terra`.
- **a3** Each catalog model lists supported levels from
  `default | high | max` and the upstream reasoning value for each level
  (`high` → `"high"`, `max` → `"xhigh"`; xAI `max` falls back to `"high"`
  when the model does not advertise `xhigh`).
- **a4** Each catalog provider stores its `baseUrl` (`xai` →
  `https://api.x.ai/v1`, `openai` → `https://api.openai.com/v1`) and its
  credential seam: `xai` authenticates via `XAI_API_KEY` (fallback
  `SUPERGROK_API_KEY`) or the stored SuperGrok OAuth token; `openai`
  authenticates via `OPENAI_API_KEY` (fallback `CODEX_API_KEY`).
- **a5** `resolve --provider` and the proxy route to the catalog's
  `baseUrl`; nothing invents an endpoint outside the catalog.
- **a6** Unknown provider or model is `PROVIDER_UNKNOWN` or
  `MODEL_UNKNOWN`. Unknown level is `USAGE`.

### WORK-2.1.2 Resolve provider + model + level on the proxy path

- **a7** Resolution order: headers
  `x-modelpatrol-provider` + `x-modelpatrol-model` (+ optional
  `x-modelpatrol-level`); else `body.model` of the form
  `provider/model`; else existing intent extraction.
- **a8** A resolved catalog route forwards to the catalog `baseUrl` with
  the catalog model id and injects the mapped reasoning effort when the
  level is not `default`.
- **a9** `default` omits reasoning effort so the provider default applies.
- **a10** Intent-only requests (`build`, `spec`, …) keep the current plan
  mapping. Ledger records `provider`, `model`, and `level` when known;
  intent-only events keep `intent` and leave provider fields null.

### WORK-2.1.3 CLI catalog, resolve, env

- **a11** `modelpatrol catalog` prints JSON
  `{ providers: [{ id, label, baseUrl, models: [{ id, levels: [{ id, reasoning }] }] }] }`.
- **a12** `modelpatrol resolve --provider ID --model ID [--level ID]`
  prints `{ provider, model, level, reasoning, baseUrl }` sourced from the
  catalog. Missing provider or model is `USAGE`.
- **a13** `modelpatrol resolve --intent ID` keeps the current plan/model
  output for compatibility.
- **a14** `modelpatrol env --provider ID --model ID [--level ID]` prints
  the same harness exports as today plus
  `MODELPATROL_PROVIDER`, `MODELPATROL_MODEL`, and `MODELPATROL_LEVEL`.
- **a15** Help lists `catalog` and the new resolve/env flags. Existing
  `--intent` flags keep working.

## Wave 2.2 — Provider usage windows

### WORK-2.2.1 Provider usage adapters

- **a16** `usage --provider xai` and `usage --provider openai` call an
  injectable HTTP adapter. Tests never hit the live provider.
- **a17** The JSON always contains `fiveHour`, `week`, and `month`. A
  missing provider window is
  `{ available: false, reason: "unsupported" | "unauthenticated" | "upstream" }`.
- **a18** A window the provider returns includes `available: true` and the
  numeric fields the adapter could parse (used, remaining, or limit).
  Unused fields are null, never guessed.
- **a19** `usage` without `--provider` keeps the current local ledger
  snapshot.

### WORK-2.2.2 CLI usage --provider

- **a20** `modelpatrol usage --provider ID` requires a known catalog
  provider. Other ids are `USAGE`.
- **a21** Unauthenticated provider usage is
  `PLAN_UNAUTHENTICATED` / exit 1, not a fake empty window.

## Out of scope

Adding Kimi, z.ai, Alibaba, OpenCode Go, or Antigravity to the catalog.
Scraping ChatGPT or grok.com HTML. Changing SuperGrok OAuth. Removing
intent routes.

## Sources

`docs/research/provider-route-and-usage.md`.