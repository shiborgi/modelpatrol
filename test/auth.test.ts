import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  deleteCredential,
  inspectCredential,
  readCredential,
  writeCredential,
} from "../src/auth/store.js";
import {
  accessTokenIsExpiring,
  pollDeviceCodeToken,
  refreshAccessToken,
  requestDeviceCode,
} from "../src/auth/xai-oauth.js";
import { ModelpatrolError } from "../src/core/errors.js";
import { credentialPath } from "../src/infra/paths.js";

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
  } as Response;
}

test("requestDeviceCode posts form-urlencoded client_id scope and referrer", async () => {
  let url = "";
  let method = "";
  let contentType = "";
  let rawBody = "";
  const fetchImpl: typeof fetch = async (input, init) => {
    url = String(input);
    method = init?.method ?? "";
    const headers = new Headers(init?.headers);
    contentType = headers.get("content-type") ?? "";
    rawBody = String(init?.body ?? "");
    return jsonResponse({
      device_code: "dc",
      user_code: "WD-CODE",
      verification_uri: "https://auth.x.ai/device",
    });
  };
  const res = await requestDeviceCode({ fetchImpl });
  assert.equal(url, "https://auth.x.ai/oauth2/device/code");
  assert.equal(method, "POST");
  assert.match(contentType, /application\/x-www-form-urlencoded/);
  const params = new URLSearchParams(rawBody);
  assert.equal(params.get("client_id"), "b1a00492-073a-47ea-816f-4c329264a828");
  assert.equal(
    params.get("scope"),
    "openid profile email offline_access grok-cli:access api:access",
  );
  assert.equal(params.get("referrer"), "modelpatrol");
  assert.equal(res.device_code, "dc");
  assert.equal(res.user_code, "WD-CODE");
  assert.equal(res.verification_uri, "https://auth.x.ai/device");
});

test("pollDeviceCodeToken handles pending slow_down deny expiry and timeout", async () => {
  const device = {
    device_code: "d",
    user_code: "u",
    verification_uri: "https://example.com",
    expires_in: 300,
    interval: 1,
  };
  const sleep = async () => undefined;

  let calls = 0;
  const pendingThenOk: typeof fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return jsonResponse({ error: "authorization_pending" }, false, 400);
    }
    if (calls === 2) {
      return jsonResponse({ error: "slow_down" }, false, 400);
    }
    return jsonResponse({ access_token: "at", refresh_token: "rt", expires_in: 3600 });
  };
  const ok = await pollDeviceCodeToken(device, { fetchImpl: pendingThenOk, sleep });
  assert.equal(ok.access_token, "at");

  await assert.rejects(
    () =>
      pollDeviceCodeToken(device, {
        fetchImpl: async () => jsonResponse({ error: "access_denied" }, false, 400),
        sleep,
      }),
    (err: unknown) => err instanceof ModelpatrolError && err.code === "OAUTH_DENIED",
  );

  await assert.rejects(
    () =>
      pollDeviceCodeToken(device, {
        fetchImpl: async () => jsonResponse({ error: "expired_token" }, false, 400),
        sleep,
      }),
    (err: unknown) => err instanceof ModelpatrolError && err.code === "OAUTH_EXPIRED",
  );

  await assert.rejects(
    () =>
      pollDeviceCodeToken(
        { ...device, expires_in: 1 },
        {
          fetchImpl: async () =>
            jsonResponse({ error: "authorization_pending" }, false, 400),
          sleep,
          now: (() => {
            let n = 0;
            return () => {
              n += 10_000;
              return n;
            };
          })(),
        },
      ),
    (err: unknown) => err instanceof ModelpatrolError && err.code === "OAUTH_TIMEOUT",
  );
});

test("refreshAccessToken posts refresh_token grant", async () => {
  let rawBody = "";
  const fetchImpl: typeof fetch = async (_url, init) => {
    rawBody = String(init?.body ?? "");
    return jsonResponse({ access_token: "newat", refresh_token: "newrt" });
  };
  const res = await refreshAccessToken("oldrt", { fetchImpl });
  const params = new URLSearchParams(rawBody);
  assert.equal(params.get("grant_type"), "refresh_token");
  assert.equal(params.get("refresh_token"), "oldrt");
  assert.equal(res.access_token, "newat");
  assert.equal(res.refresh_token, "newrt");
});

test("accessTokenIsExpiring reads jwt exp", () => {
  const past = Math.floor(Date.now() / 1000) - 10;
  const b64 = Buffer.from(JSON.stringify({ exp: past }))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const token = `header.${b64}.sig`;
  assert.equal(accessTokenIsExpiring(token, 0), true);
});

test("store writes 0600 file, delete is idempotent, corrupt is null", () => {
  const home = mkdtempSync(join(tmpdir(), "modelpatrol-store-"));
  try {
    const cred = { access: "a-token", refresh: "r-token", expires: 1234567890000 };
    writeCredential(home, "supergrok", cred);
    const path = credentialPath(home, "supergrok");
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const got = readCredential(home, "supergrok");
    assert.deepEqual(got, { ...cred, tokenType: undefined });

    deleteCredential(home, "supergrok");
    assert.equal(readCredential(home, "supergrok"), null);
    deleteCredential(home, "supergrok");

    mkdirSync(join(home, "credentials"), { recursive: true });
    writeFileSync(path, "{bad", { mode: 0o600 });
    assert.equal(readCredential(home, "supergrok"), null);
    assert.equal(inspectCredential(home, "supergrok").status, "invalid");
    assert.doesNotMatch(readFileSync(path, "utf8"), /a-token/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
