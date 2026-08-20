# INIT-1 — SuperGrok device-code connect

Recorded on CodePatrol as Initiative `INIT-1`, Wave `WAVE-1.1`.

## Intent

Let an operator attach the SuperGrok plan with the same device-authorization
flow OpenCode uses for xAI: the CLI prints a URL and a short code, optionally
opens a browser, polls until the operator types the code, and then uses the
resulting access token on `api.x.ai`. Environment API keys keep working and
still win over a stored token.

## Operator flow

```text
modelpatrol connect --plan supergrok
# prints verificationUri + userCode
# opens the URL unless --no-browser
# operator types the code in the browser
# tokens land in ~/.modelpatrol/credentials/supergrok.json

modelpatrol start --detach
# intents mapped to SuperGrok now authenticate with the stored access token
```

## Classification

Structural: new Credential and Connect concepts. Auth today is env-only
(`resolvePlanKey`). Other plans stay on API keys.

## Wave 1.1

### WORK-1.1.1 Device-authorization client

RFC 8628 against `auth.x.ai`. Public Grok-CLI `client_id`, OpenCode scopes,
injectable HTTP. No loopback server.

- **a1** Device-code POST returns `device_code`, `user_code`, `verification_uri`.
- **a2** Poll handles `authorization_pending`, `slow_down`, deny, expiry, deadline.
- **a3** Refresh token grant; keep old refresh if response omits one.
- **a4** Constants overridable; tests never call the live issuer.

### WORK-1.1.2 OAuth credential store

- **a5** Write `~/.modelpatrol/credentials/supergrok.json` mode `0600`.
- **a6** Tokens never appear in `config.json` or `ledger.jsonl`.
- **a7** Disconnect deletes the file; missing file is a no-op.
- **a8** Corrupt file is absent on the proxy path; doctor reports `CONFIG_INVALID`.

### WORK-1.1.3 CLI connect and disconnect

- **a9** `connect --plan supergrok` prints URI + code, then `{ ok, plan, expires }`.
- **a10** Opens `verification_uri_complete` or `verification_uri`; open failure is ignored.
- **a11** `--no-browser` never opens a browser.
- **a12** Other plan ids are `USAGE`. `disconnect` removes the file.
- **a13** Help lists the new commands; existing CLI shapes stay.

### WORK-1.1.4 Resolve SuperGrok credential on the proxy path

- **a14** `XAI_API_KEY` / `SUPERGROK_API_KEY` win over OAuth.
- **a15** Else Bearer from the store is sent to `https://api.x.ai/v1`.
- **a16** Refresh 120s before expiry; concurrent refreshes share one request.
- **a17** Neither source → `PLAN_UNAUTHENTICATED` / 401.
- **a18** `doctor` reports `authSource`: `env` | `oauth` | `missing`.

## Out of scope

OAuth for Codex, z.ai, Alibaba, Kimi, OpenCode Go, or Antigravity. Changing
intent-to-plan mapping. A local callback HTTP server.

## Sources

`docs/research/xai-device-oauth.md` (xAI news, `auth.x.ai` OIDC discovery,
RFC 8628, OpenCode `xai.ts`).
