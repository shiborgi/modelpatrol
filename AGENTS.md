# Repository guidance

- ModelPatrol owns LLM transport, model selection and usage observability.
- Keep workflow authority in CodePatrol, personas in AgentPatrol, repository
  analysis in ContextPatrol, and persistent insights in MemoryPatrol.
- Use independent Node.js 22.13+ ESM modules; do not import sibling source trees.
- Keep subscription harnesses in the single gateway process behind the internal
  adapter registry; do not create provider-specific connector servers or ports.
- Configuration is a closed, versioned Patrol 1.0 contract. Preserve native provider wire formats.
- Never fabricate usage, prices, model access or subscription entitlement. Unknown cost is null.
- Keep credentials and inference payloads out of telemetry. Metadata is not authorization.
- No automatic retry after ambiguous dispatch or after streaming begins.
- Tests use temporary fixtures and simulated upstreams, never paid provider calls.
- Keep code, documentation and comments in English. Document partial Helicone parity honestly.
- Quality gates: `npm run verify` and `npm run release-check`.
