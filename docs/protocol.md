# ModelPatrol Protocol 1.0

ModelPatrol is an independent HTTP service. It does not import sibling source
trees. Its control configuration requires `protocolVersion: "1.0"`; provider
inference bodies retain their native schema rather than a Patrol wrapper.

All inference endpoints require `Authorization: Bearer <gateway key>`.
Dashboard and `/admin/*` routes are intentionally unauthenticated, but only
served to loopback and Tailscale CGNAT addresses. Health/static assets are
public and contain no workspace records or credentials.

## Metadata

| Header | Meaning |
| --- | --- |
| `X-Patrol-Step` | CodePatrol stage |
| `X-Patrol-Agent` | Resolved AgentPatrol persona |
| `X-Patrol-Profile` | Comma-separated resolved specialist profiles |
| `X-Patrol-Harness` | `opencode` or `pi` |
| `X-Patrol-Project` | Operator-selected project label |
| `X-Patrol-Run-Id` | CodePatrol run UUID |
| `X-Patrol-Session-Id` | Correlated conversation/session |
| `X-Patrol-Trace-Id` | Stage trace |
| `X-Patrol-Parent-Id` | Optional parent span |

Values are at most 256 ASCII characters and restricted to identifiers,
commas, spaces, periods, slashes, colons, underscores and hyphens. Metadata is
trusted caller labeling, not authorization. Gateway clients may not choose
upstream URLs or credentials. Metadata is consumed locally, never forwarded
to providers. Inference responses include `X-ModelPatrol-Request-Id`,
`X-ModelPatrol-Model` and `X-ModelPatrol-Route` on successful upstream calls.

Explicit aliases never silently fallback. Automatic selection enforces API
and capability constraints before rule priorities. UTF-8 byte size provides a
conservative context estimate; it is not token-count evidence. An unavailable
or incompatible model fails, rather than fabricating execution.

## Storage

ModelPatrol stores local state in SQLite at `dataDir/usage.sqlite`. A process
lock prevents multiple gateway instances from opening the same local database.
Request bodies, responses, raw errors and credentials are not stored. Failed
requests may record a sanitized gateway validation reason (`failure`); provider
error text is never persisted or returned.

## Admin endpoints

| Endpoint | Behavior |
| --- | --- |
| `GET /admin/requests` | Filtered recent usage records |
| `GET /admin/metrics?groupBy=model` | Grouped usage, p50/p95 latency, error rate, TTFB |
| `GET /admin/providers` | Sanitized provider status, plans and model catalog |
| `GET /admin/providers/:id/usage` | Harness Adapter Protocol quota snapshot |
| `GET /admin/export` | Bounded JSONL download |

Filters: `from`, `to` (ISO timestamps), `model`, `provider`, `status`, `step`,
`agent`, `profile`, `harness`, `project`, `run-id`, `session-id`, `trace-id`.
Profile filtering matches the complete stored value; routing rules match
individual entries. Administrative access is limited to the trusted interface
and does not train models or grant CodePatrol workflow approval.

## Central harness registry

Subscription or CLI-backed providers execute inside the single ModelPatrol
process through a registered adapter. The closed provider configuration uses
`transport.kind: "harness"`, an adapter ID and an optional workspace environment
variable. No provider-specific HTTP server or port is created.

Every adapter implements capabilities, invoke, usage and health. Usage is
exposed through the same provider-scoped administration endpoint as HTTP account
readers and has this normalized shape:

```json
{"protocolVersion":"1.0","status":"available","fetchedAt":"2026-01-01T00:00:00.000Z","limits":[{"id":"session","window":"rolling","usedFraction":0.25,"remainingFraction":null,"resetsAt":null}]}
```

`status: "unavailable"` with an empty `limits` array is the required response
when a CLI/provider does not expose quota. Fractions and reset times that are
not reported must be `null`; adapters must not estimate them.

Malformed/provider failures return sanitized errors. Incomplete/error SSE is
terminated and recorded as failure, with no retry after streaming begins.
First-byte latency measures the first forwarded SSE content bytes. Native
harness streams preserve terminal usage when the CLI reports it and never fabricate
incremental data. Missing usage remains unknown. No raw provider errors are
exposed or persisted.
