import assert from "node:assert/strict";
import { test } from "node:test";
import { ollamaUsage } from "../src/ollama-account.mjs";

const payload = {
  activity: { cost: "0.00000", period: { type: "last_4_weeks" }, models: [] },
  limits: {
    session: { usage: 0, models: [] },
    weekly: { usage: 0.001, models: [{ name: "glm-5.3-flash", request_count: 9 }] },
  },
};
const ok = (body = payload, status = 200) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

test("ollamaUsage returns session and weekly allowance fractions", async () => {
  const result = await ollamaUsage("secret", { fetchImpl: ok() });
  assert.equal(result.session.usedFraction, 0);
  assert.equal(result.weekly.usedFraction, 0.001);
  assert.match(result.fetchedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("ollamaUsage requires an API key", async () => {
  await assert.rejects(ollamaUsage(""), /API key is not configured/);
  await assert.rejects(ollamaUsage(undefined), /API key is not configured/);
});

test("ollamaUsage rejects failed responses", async () => {
  await assert.rejects(ollamaUsage("secret", { fetchImpl: ok({}, 401) }), /401/);
});

test("ollamaUsage maps malformed limits to null instead of fabricating", async () => {
  const result = await ollamaUsage("secret", { fetchImpl: ok({ limits: { session: {}, weekly: { usage: -1 } } }) });
  assert.equal(result.session.usedFraction, null);
  assert.equal(result.weekly.usedFraction, null);
});
