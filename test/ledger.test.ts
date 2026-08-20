import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { LedgerEvent } from "../src/core/model.js";
import { ledgerPath } from "../src/infra/paths.js";
import { appendEvent, readEvents } from "../src/ledger/store.js";

test("appendEvent then readEvents round-trips", () => {
  const home = mkdtempSync(join(tmpdir(), "modelpatrol-ledger-"));
  const event: LedgerEvent = {
    id: "evt_round",
    ts: "2026-08-19T12:00:00.000Z",
    intent: "spec",
    plan: "kimi",
    model: "kimi-k2.5",
    provider: null,
    level: null,
    protocol: "openai",
    harness: "pi",
    promptTokens: 8,
    completionTokens: 2,
    totalTokens: 10,
    costUsd: 0.0001,
    status: 200,
    latencyMs: 5,
    streamed: false,
    error: null,
  };
  appendEvent(home, event);
  assert.deepEqual(readEvents(home), [event]);
});

test("readEvents skips corrupt lines", () => {
  const home = mkdtempSync(join(tmpdir(), "modelpatrol-ledger-bad-"));
  appendFileSync(ledgerPath(home), "not-json\n");
  assert.deepEqual(readEvents(home), []);
});
