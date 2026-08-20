# Findings: xAI SuperGrok device authorization

Facts only. No design decisions.

## Product claim

xAI documents that SuperGrok or X Premium can be used inside OpenCode after
`/connect` and picking xAI. Two sign-in methods both use the Grok
subscription: a browser OAuth path and a headless path that prints a code
and a URL. Source: https://x.ai/news/grok-opencode (21 May 2026).

## Authorization server

`GET https://auth.x.ai/.well-known/openid-configuration` (retrieved 19 Aug
2026) reports:

- issuer: `https://auth.x.ai`
- `device_authorization_endpoint`: `https://auth.x.ai/oauth2/device/code`
- `token_endpoint`: `https://auth.x.ai/oauth2/token`
- `revocation_endpoint`: `https://auth.x.ai/oauth2/revoke`
- `grant_types_supported` includes `urn:ietf:params:oauth:grant-type:device_code`
  and `refresh_token`
- `token_endpoint_auth_methods_supported` includes `none` (public client)
- `scopes_supported` includes `openid`, `profile`, `email`, `offline_access`,
  `grok-cli:access`, `api:access`

## Device grant

RFC 8628 defines the device authorization grant: the client obtains a
`device_code` and `user_code`, shows `verification_uri` (and optional
`verification_uri_complete`), and polls the token endpoint until the user
approves, denies, or the code expires. `authorization_pending` continues
polling; `slow_down` increases the interval by at least 5 seconds.
Source: RFC 8628 §§3.1–3.5.

## OpenCode client behavior

OpenCode's `packages/opencode/src/plugin/xai.ts` (anomalyco/opencode, fetched
from the `dev` branch) implements that grant with:

- public `client_id` `b1a00492-073a-47ea-816f-4c329264a828`
- `scope` `openid profile email offline_access grok-cli:access api:access`
- `referrer` `opencode` on the device-code request
- form-urlencoded POST, `Accept: application/json`
- poll defaults: 5s interval (min 1s), 5 minute expiry fallback, +5s on
  `slow_down`
- refresh via `grant_type=refresh_token` with the same `client_id`
- access-token refresh skew of 120 seconds
- Bearer token on `https://api.x.ai/v1` after connect
- API-key method remains available as a separate path

## Current ModelPatrol SuperGrok plan

`src/config/defaults.ts` defines plan `supergrok` as OpenAI-protocol
`https://api.x.ai/v1` authenticated only by `XAI_API_KEY` or
`SUPERGROK_API_KEY`. `src/routing/resolve.ts` `resolvePlanKey` reads those
environment names and nothing else. No connect command exists in
`src/cli/index.ts`.
