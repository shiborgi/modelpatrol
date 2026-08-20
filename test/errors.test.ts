import assert from "node:assert/strict";
import { test } from "node:test";

import { type ErrorCode, ModelpatrolError } from "../src/core/errors.js";

const DOMAIN_CODES: ErrorCode[] = [
  "CONFIG_INVALID",
  "CONFIG_MISSING",
  "INTENT_UNKNOWN",
  "PLAN_UNKNOWN",
  "PLAN_UNAUTHENTICATED",
  "OAUTH_DENIED",
  "OAUTH_EXPIRED",
  "OAUTH_TIMEOUT",
  "WINDOW_EXCEEDED",
  "UPSTREAM_FAILED",
  "PROXY_NOT_RUNNING",
  "PROXY_ALREADY_RUNNING",
  "INTERNAL",
];

test("USAGE maps to exit code 2", () => {
  const err = new ModelpatrolError("USAGE", "bad input");
  assert.equal(err.code, "USAGE");
  assert.equal(err.exitCode, 2);
});

test("every domain error maps to exit code 1", () => {
  for (const code of DOMAIN_CODES) {
    const err = new ModelpatrolError(code, "boom");
    assert.equal(err.exitCode, 1, `${code} should exit 1`);
    assert.equal(err.code, code);
  }
});
