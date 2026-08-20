import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultConfig } from "../src/config/defaults.js";
import { estimateCostUsd, estimateTokensFromText } from "../src/ledger/pricing.js";

test("estimateCostUsd uses per-million prices", () => {
  const config = defaultConfig();
  const cost = estimateCostUsd(config, "gpt-5.3-codex", 1_000_000, 1_000_000);
  assert.equal(cost, 15.75);
});

test("unknown models cost zero", () => {
  assert.equal(estimateCostUsd(defaultConfig(), "unknown-model", 1000, 1000), 0);
});

test("estimateTokensFromText is byte-conservative", () => {
  assert.equal(estimateTokensFromText("abcd"), 1);
  assert.equal(estimateTokensFromText("abcdefgh"), 2);
});
