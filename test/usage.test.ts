import assert from "node:assert/strict";
import { test } from "node:test";

import { ModelpatrolError } from "../src/core/errors.js";
import { fetchProviderUsage, openaiUsage, xaiUsage } from "../src/providers/usage.js";

test("openai usage maps organization usage into week/month", async () => {
  let called = 0;
  const fetchImpl: typeof fetch = async (input) => {
    called += 1;
    assert.match(String(input), /organization\/usage\/completions/);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        result: {
          week: { used: 1200 },
          month: { used: 4800 },
        },
      }),
      text: async () => "",
      headers: new Headers(),
    } as Response;
  };
  const usage = await openaiUsage({
    fetchImpl,
    env: { OPENAI_API_KEY: "sk-test" },
  });
  assert.equal(called, 1);
  assert.equal(usage.provider, "openai");
  assert.deepEqual(usage.windows.fiveHour, { available: false, reason: "unsupported" });
  assert.deepEqual(usage.windows.week, {
    available: true,
    used: 1200,
    remaining: null,
    limit: null,
  });
  assert.deepEqual(usage.windows.month, {
    available: true,
    used: 4800,
    remaining: null,
    limit: null,
  });
});

test("openai usage is unauthenticated without a key", async () => {
  await assert.rejects(
    () => openaiUsage({ env: {} }),
    (err: unknown) =>
      err instanceof ModelpatrolError && err.code === "PLAN_UNAUTHENTICATED",
  );
});

test("openai usage maps 401 to unauthenticated and transport errors to upstream", async () => {
  const unauthorized: typeof fetch = async () =>
    ({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => "",
      headers: new Headers(),
    }) as Response;
  const up = await openaiUsage({
    fetchImpl: unauthorized,
    env: { OPENAI_API_KEY: "k" },
  });
  assert.equal(up.windows.week.available, false);
  assert.equal(
    up.windows.week.available === false ? up.windows.week.reason : "x",
    "unauthenticated",
  );

  const throwing: typeof fetch = async () => {
    throw new Error("network down");
  };
  const down = await openaiUsage({ fetchImpl: throwing, env: { OPENAI_API_KEY: "k" } });
  assert.equal(down.windows.week.available, false);
  assert.equal(
    down.windows.week.available === false ? down.windows.week.reason : "x",
    "upstream",
  );
});

test("xai usage reports unsupported without any HTTP call", async () => {
  let called = 0;
  const fetchImpl: typeof fetch = async () => {
    called += 1;
    throw new Error("should not be called");
  };
  const usage = await xaiUsage({ fetchImpl, env: {} });
  assert.equal(called, 0);
  assert.deepEqual(usage.windows.fiveHour, { available: false, reason: "unsupported" });
  assert.deepEqual(usage.windows.week, { available: false, reason: "unsupported" });
  assert.deepEqual(usage.windows.month, { available: false, reason: "unsupported" });
});

test("fetchProviderUsage resolves a known adapter and rejects unknown providers", async () => {
  const usage = await fetchProviderUsage("xai", { env: {} });
  assert.equal(usage.provider, "xai");
  await assert.rejects(
    () => fetchProviderUsage("nope"),
    (err: unknown) =>
      err instanceof ModelpatrolError && err.code === "PROVIDER_UNKNOWN",
  );
});
