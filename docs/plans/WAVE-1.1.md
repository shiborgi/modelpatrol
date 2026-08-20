# WAVE-1.1 Plan — SuperGrok device-code connect

## Approach

Reuse `resolvePlanKey` as the credential seam. Add two modules:

- `src/auth/xai-oauth.ts` — RFC 8628 client (request, poll, refresh)
- `src/auth/store.ts` — one JSON file per plan under `credentials/`

No new npm dependencies. fetch, clock, sleep, and browser opener are
injectable. Other plans stay env-only.

## Modules

| Module | Role |
| ------ | ---- |
| `src/auth/xai-oauth.ts` | device grant + refresh |
| `src/auth/store.ts` | persist / delete / inspect |
| `src/infra/paths.ts` | `credentialPath` |
| `src/core/errors.ts` | `OAUTH_DENIED`, `OAUTH_EXPIRED`, `OAUTH_TIMEOUT` |
| `src/routing/resolve.ts` | env then oauth |
| `src/cli/index.ts` | `connect`, `disconnect` |
| `src/cli/args.ts` | `--no-browser` |

## Precedence

1. `XAI_API_KEY` / `SUPERGROK_API_KEY`
2. stored OAuth access token (refresh 120s early)
3. `PLAN_UNAUTHENTICATED`

## Verification

`npm run verify`
