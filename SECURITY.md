# Security

ModelPatrol is a local LLM proxy. Credentials and prompts stay on the machine
that runs it.

1. **Local bind by default.** The proxy listens on `127.0.0.1`. It does not
   accept remote connections unless `host` is changed in config.
2. **Upstream keys stay in the environment.** Plan API keys are read from
   environment variables and never written to the ledger or to `config.json`.
3. **No remote authority.** There is no cloud account, telemetry endpoint, or
   mesh. Usage lives in a local JSONL ledger under `~/.modelpatrol`.
4. **Optional gate token.** When `requireToken` is true, inbound requests must
   present `MODELPATROL_TOKEN`. The token is not persisted.
5. **Passthrough bodies.** Prompts are forwarded to the selected plan and are
   not stored in the ledger. Only counts, cost estimates, and route metadata
   are recorded.

## Limitations

- Binding to a non-loopback address exposes the proxy to the local network.
- A killed process can leave `proxy.pid` behind; `modelpatrol stop` or
  removing the file is enough once no process holds the port.
- Estimated `costUsd` is list-price arithmetic. Subscription coding plans do
  not bill per token; the figure is for comparison across windows, not a
  invoice.
