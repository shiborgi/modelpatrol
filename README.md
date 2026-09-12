# ModelPatrol

Independent, local-first LLM gateway for the Patrol family. Node.js 22.13+ and ESM.
SQLite is the storage backend for this first, local-only release.
ModelPatrol owns model selection, upstream transport, usage accounting and the
dashboard. CodePatrol owns workflows and trusted execution; AgentPatrol owns
personas/profiles; ContextPatrol owns neutral repository analysis.

## Start

```sh
npm install -g 'git+ssh://git@github.com/shiborgi/modelpatrol.git#<commit-sha>'
cp examples/modelpatrol.json modelpatrol.json
export MODELPATROL_API_KEY="replace-with-a-long-random-gateway-secret"
export ANTHROPIC_API_KEY="your-api-key"
modelpatrol check --config modelpatrol.json
modelpatrol serve --config modelpatrol.json
```

Open `http://127.0.0.1:4318`. Dashboard and administration are restricted to
loopback and Tailscale CGNAT addresses. Configure whichever providers you use; missing credentials exclude a
provider from routing. From a source checkout, run `npm ci`, `npm run verify` and
`npm run release-check`. Model IDs, context limits and capability declarations in
the example are illustrative: confirm availability for your account. Set your
contracted rates before interpreting spend. No keys or model calls are required
for tests. `npm run release-check` tests the installed tarball.

## Explicit model or automatic routing

```sh
curl http://127.0.0.1:4318/v1/chat/completions \
  -H "Authorization: Bearer $MODELPATROL_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'X-Patrol-Step: build' \
  -H 'X-Patrol-Agent: developer' \
  -H 'X-Patrol-Profile: general,react' \
  -H 'X-Patrol-Harness: opencode' \
  -d '{"model":"auto","messages":[{"role":"user","content":"Explain this change"}]}'
```

Use a configured ID such as `anthropic/sonnet` to pin a model. `auto` first checks
wire protocol, capabilities, output/context limits, credentials and circuit
availability. The first matching metadata rule supplies priorities. Otherwise
the configured default applies; remaining candidates use operator-declared
quality and configured price. Decisions are deterministic and recorded.
Rules are operator policy, not learned model-quality evidence.

Native routes: `POST /v1/chat/completions`, `/v1/responses`, `/v1/messages`;
`GET /v1/models` lists configured aliases. JSON and SSE are passed through with
the upstream model ID. Tool calls and results remain in their original format.
`auto` does **not** translate between incompatible direct HTTP protocols. Local
subscription harnesses additionally expose a normalized Chat interface so Pi and
CodePatrol can route one request across their different CLI protocols. Anthropic's
direct Chat Completions compatibility has provider-documented limitations; use
Messages for native Anthropic API features.
Server-side conversations (`previous_response_id` or `conversation`) require an
explicit model to keep provider-owned conversation state on the same endpoint.

## Subscription harnesses

Subscription-backed CLIs run inside the single ModelPatrol process through the
[central harness contract](docs/harnesses.md). Each provider selects a registered
adapter through `transport.kind: "harness"`; ModelPatrol owns routing and the
adapter owns its local authenticated CLI session. Codex, Claude, Grok and
Antigravity translate native partial events into Chat SSE. OpenCode forwards
headless `run --format json` text records as soon as its CLI publishes them.
Direct Ollama SSE passes through the same gateway without buffering.

## Lean local deployment

For Patrol harnesses running on one machine, use SQLite and the central harness
registry. Copy
`deploy/local.env.example` to `deploy/local.env`, set distinct gateway/admin
key and allowed workspaces, then run `./deploy/local.sh`. It starts one gateway
process and persists observability data in `.modelpatrol/usage.sqlite`.

See [protocol](docs/protocol.md), [CodePatrol/harness setup](docs/integrations.md),
[provider plans](docs/providers.md), [subscription harnesses](docs/harnesses.md),
and [Helicone coverage](docs/helicone-coverage.md).

## Tokens, prices and budgets

Model `pricing` fields are USD per million tokens:

```json
{"pricing":{"input":1.0,"output":2.0,"cacheRead":0.1,"cacheWrite":1.25}}
```

These numbers are examples, not current vendor prices. Actual provider usage
supplies input/output/cache tokens. Absent usage or pricing yields `null` cost,
never zero-cost evidence. Subscription monthly fees are displayed separately;
per-request cash cost stays unknown. Cached gateway responses explicitly record
zero *new upstream* tokens and spend. Pi's required local numeric price fields
are placeholders; use the gateway for accounting, not Pi's displayed cost.

Optional `budgetUsd` is a monthly UTC metered-token guard. Dispatch reserves a
conservative UTF-8 byte-based input estimate and bounded output. Unknown final
cost retains that reservation durably. API tool charges, provider-side hidden
context and invoice adjustments are not included; this is not an invoice cap.
Subscription/unknown-priced models cannot dispatch under this metered budget.
Use provider billing limits for a hard financial ceiling.

## Observability

SQLite stores request IDs, route reasons, attempts, elapsed time, first-byte
latency, tokens, costs, outcomes and approved metadata. Prompt/response bodies,
raw errors and credentials are not recorded. Session/run/trace IDs correlate
agent calls. The dashboard provides grouped usage, request inspection, plan
status, date/run filters and JSONL export. Metrics/explorer/export
are bounded to the latest 10,000 matching records (explorer defaults to 500),
with this sampling limit displayed. Monthly budget queries use all monthly rows.

Rate/concurrency limits, a 30-second circuit cooldown, and fallback on 429/503
are included. No fallback after a stream starts or after ambiguous network
failure. Exact response caching is disabled by default; enable `cache.ttlMs`
and send `X-Patrol-Cache: true` for individual non-streaming calls. Cache lives
only in memory and is bounded by entries and 64 KiB per response.

## Operational scope

Single trusted workspace, one server per database; CLI enforces a lock file.
After an unclean shutdown, verify the recorded process is no longer running
before removing `server.lock`. Bind to loopback or put TLS and access control
in front of the service. Back up the SQLite database with a SQLite-aware tool
or stop the server first. Retention cleanup, multi-tenant RBAC, distributed
quotas and automatic credential refresh are not implemented.

This is an original Patrol implementation inspired by Helicone, not a fork or
complete replacement. The coverage document identifies the implemented subset
and remaining Helicone features explicitly. No live provider/harness execution
is claimed by the fixture tests.
