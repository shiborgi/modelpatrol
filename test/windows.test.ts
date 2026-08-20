import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultConfig } from "../src/config/defaults.js";
import { ModelpatrolError } from "../src/core/errors.js";
import type { LedgerEvent } from "../src/core/model.js";
import {
  assertWindowsAllow,
  snapshotAll,
  snapshotWindow,
} from "../src/ledger/windows.js";

function event(overrides: Partial<LedgerEvent>): LedgerEvent {
  return {
    id: "evt_1",
    ts: "2026-08-19T12:00:00.000Z",
    intent: "build",
    plan: "codex",
    model: "gpt-5.3-codex",
    provider: null,
    level: null,
    protocol: "openai",
    harness: "opencode",
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    costUsd: 0.5,
    status: 200,
    latencyMs: 10,
    streamed: false,
    error: null,
    ...overrides,
  };
}

test("snapshotWindow keeps only events inside the 5h window", () => {
  const now = new Date("2026-08-19T12:00:00.000Z");
  const events = [
    event({ id: "old", ts: "2026-08-19T06:00:00.000Z", totalTokens: 999 }),
    event({ id: "in", ts: "2026-08-19T08:00:00.000Z", totalTokens: 10, costUsd: 0.1 }),
  ];
  const snap = snapshotWindow(events, "fiveHour", now);
  assert.equal(snap.totals.calls, 1);
  assert.equal(snap.totals.totalTokens, 10);
  assert.equal(snap.byPlan.codex?.calls, 1);
});

test("snapshotAll reports fiveHour, week and month", () => {
  const snaps = snapshotAll([event({})], new Date("2026-08-19T12:00:00.000Z"));
  assert.deepEqual(
    snaps.map((s) => s.window),
    ["fiveHour", "week", "month"],
  );
});

test("assertWindowsAllow blocks when a cap is exceeded", () => {
  const config = defaultConfig();
  config.windows.fiveHour.maxCalls = 1;
  config.windows.fiveHour.onExceed = "block";
  const snaps = snapshotAll(
    [event({}), event({ id: "evt_2" })],
    new Date("2026-08-19T12:00:00.000Z"),
  );
  assert.throws(
    () => assertWindowsAllow(config, snaps),
    (err: unknown) => err instanceof ModelpatrolError && err.code === "WINDOW_EXCEEDED",
  );
});

test("assertWindowsAllow warns without throwing", () => {
  const config = defaultConfig();
  config.windows.week.maxCostUsd = 0.1;
  config.windows.week.onExceed = "warn";
  const snaps = snapshotAll(
    [event({ costUsd: 1 })],
    new Date("2026-08-19T12:00:00.000Z"),
  );
  const breaches = assertWindowsAllow(config, snaps);
  assert.equal(breaches.length, 1);
  assert.equal(breaches[0]?.onExceed, "warn");
});
