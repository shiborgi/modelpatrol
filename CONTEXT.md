# Domain glossary

- **Intent** — stable id of a CodePatrol stage (`spec`, `plan`, `build`, …).
  The inbound model name is an intent when it matches a configured id.
- **Plan** — a coding-plan pool (Codex, SuperGrok, Kimi, …) with one protocol
  and one base URL.
- **Credential** — secret used to call a plan: an environment API key or a
  stored OAuth access token. Never written to `config.json` or the ledger.
- **Device authorization** — RFC 8628 grant: the CLI shows a URL and a short
  user code; the operator types the code in a browser; the CLI polls for
  tokens.
- **Connect** — CLI operation that obtains and stores a plan Credential via
  device authorization.
- **Disconnect** — CLI operation that forgets a stored OAuth Credential.
- **Provider** — upstream vendor id (`xai`, `openai`) with one base URL
  and one credential seam.
- **Catalog model** — a named model id under a Provider (`grok-4.6`,
  `gpt-5.6-sol`, …). Distinct from a CodePatrol Intent.
- **Level** — operator reasoning knob (`default`, `high`, `max`) mapped
  to the provider's `reasoning_effort` value.
- **Catalog** — built-in table of Providers, Catalog models, and Levels.
- **Provider usage** — 5h / week / month windows returned by the
  Provider when it exposes them; otherwise marked unavailable.
