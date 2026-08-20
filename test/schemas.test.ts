import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultConfig } from "../src/config/defaults.js";
import { configSchema, ledgerEventSchema } from "../src/core/schemas.js";

test("default config passes the schema", () => {
  const parsed = configSchema.safeParse(defaultConfig());
  assert.equal(parsed.success, true);
});

test("config rejects unknown fields", () => {
  const parsed = configSchema.safeParse({ ...defaultConfig(), extra: true });
  assert.equal(parsed.success, false);
});

test("ledger event requires protocol and counts", () => {
  const parsed = ledgerEventSchema.safeParse({
    id: "evt_1",
    ts: "2026-01-01T00:00:00.000Z",
    intent: "build",
    plan: "codex",
    model: "gpt-5.3-codex",
    protocol: "openai",
    harness: "opencode",
    promptTokens: 10,
    completionTokens: 4,
    totalTokens: 14,
    costUsd: 0.001,
    status: 200,
    latencyMs: 12,
    streamed: false,
    error: null,
  });
  assert.equal(parsed.success, true);
});
