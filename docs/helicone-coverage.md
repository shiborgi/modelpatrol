# Helicone reference and coverage

Reference: [Helicone repository](https://github.com/helicone/helicone) and
[platform overview](https://docs.helicone.ai/getting-started/platform-overview),
consulted September 7, 2026. ModelPatrol is independently written; no Helicone
source code or branding assets are incorporated.

The requested full Helicone parity is **not complete**. This initial package
implements the gateway and Patrol-specific observability foundation below.
Do not interpret API storage endpoints as an equivalent of Helicone's full
experimentation products.

| Area | ModelPatrol implementation | Remaining scope |
| --- | --- | --- |
| Gateway | Five configurable presets; native JSON/SSE APIs | Universal format translation, account discovery |
| Routing | Explicit/auto, metadata policies, capability gates, explanations | Learned routing, quality feedback optimization |
| Reliability | Bounded I/O, timeout/cancel, 429/503 fallback, circuit cooldown | Distributed health/load balancing |
| Observability | Durable request/attempt history, usage/cache tokens, estimated cost, error/latency metrics | Payload inspection/redaction pipeline, full OTEL span ingest |
| Sessions | Run/session/trace/parent correlation and filters | Hierarchical interactive trace graph |
| Dashboard | Usage groups, requests, plan status, filters, export | Custom chart builder, time-series analytics, user analytics |
| Controls | Global RPM/concurrency, metered monthly reservation guard | Per-key quotas, distributed budgets, invoice reconciliation |
| Cache | Opt-in bounded exact in-memory response cache | Persistent/semantic caching |
| Alerts | HTTP errors and dashboard usage visibility | Configurable alert rules, notifications/webhooks |
| Subscriptions | Fixed-fee plan metadata, centralized CLI harnesses and normalized quota readers | Additional provider-native quota sources and refresh controls |
| Operations | Local SQLite, separate admin/gateway secrets | SSO/RBAC, multi-tenancy, production scale, retention jobs |

The gateway can be deployed independently today after configuring real provider
credentials. Full parity requires the remaining product and infrastructure work;
existing Helicone installations are not replaced or modified automatically.
