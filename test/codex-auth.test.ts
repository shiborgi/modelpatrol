import assert from "node:assert/strict";
import { test } from "node:test";

import {
  exchangeToken,
  pollDeviceCodeToken,
  requestDeviceCode,
} from "../src/auth/codex-oauth.js";
import { ModelpatrolError } from "../src/core/errors.js";

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
  } as Response;
}

test("Codex device request returns verification data through injected fetch", async () => {
  let url = "";
  const device = await requestDeviceCode({
    deviceUrl: "https://example.test/usercode",
    fetchImpl: async (input) => {
      url = String(input);
      return response({ device_code: "dc", user_code: "ABCD-EFGH", expires_in: 300 });
    },
  });
  assert.equal(url, "https://example.test/usercode");
  assert.equal(device.device_code, "dc");
  assert.equal(device.user_code, "ABCD-EFGH");
  assert.equal(device.verification_uri, "https://auth.openai.com/codex/device");
});

test("Codex polling handles pending and slow_down before success", async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const token = await pollDeviceCodeToken(
    { device_code: "dc", user_code: "code", verification_uri: "https://example.test" },
    {
      pollUrl: "https://example.test/poll",
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return response({ error: "authorization_pending" }, 400);
        if (calls === 2) return response({ error: "slow_down" }, 400);
        return response({
          access_token: "access",
          refresh_token: "refresh",
          expires_in: 3600,
        });
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    },
  );
  assert.equal(token.access_token, "access");
  assert.equal(calls, 3);
  assert.equal(sleeps.length, 2);
  assert.ok((sleeps[1] ?? 0) > (sleeps[0] ?? 0));
});

test("Codex polling maps denial and expiry to distinct errors", async () => {
  const denied = pollDeviceCodeToken(
    { device_code: "dc", user_code: "code", verification_uri: "https://example.test" },
    { fetchImpl: async () => response({ error: "access_denied" }, 400) },
  );
  await assert.rejects(
    denied,
    (err: unknown) => err instanceof ModelpatrolError && err.code === "OAUTH_DENIED",
  );

  const expired = pollDeviceCodeToken(
    { device_code: "dc", user_code: "code", verification_uri: "https://example.test" },
    { fetchImpl: async () => response({ error: "expired_token" }, 400) },
  );
  await assert.rejects(
    expired,
    (err: unknown) => err instanceof ModelpatrolError && err.code === "OAUTH_EXPIRED",
  );
});

test("Codex token exchange posts the authorization code", async () => {
  let body = "";
  const token = await exchangeToken("auth-code", {
    tokenUrl: "https://example.test/token",
    fetchImpl: async (_input, init) => {
      body = String(init?.body ?? "");
      return response({
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 3600,
      });
    },
  });
  assert.equal(token.access_token, "access");
  assert.match(body, /auth-code/);
});
