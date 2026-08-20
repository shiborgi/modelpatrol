import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultConfig } from "../src/config/defaults.js";
import { ModelpatrolError } from "../src/core/errors.js";
import { extractIntent } from "../src/routing/intent.js";
import { resolvePlanKey, resolveRoute } from "../src/routing/resolve.js";

test("extractIntent prefers the header over the model field", () => {
  const config = defaultConfig();
  const intent = extractIntent({
    config,
    headers: { "x-modelpatrol-intent": "plan" },
    model: "build",
  });
  assert.equal(intent, "plan");
});

test("extractIntent treats a known model name as the intent", () => {
  const config = defaultConfig();
  const intent = extractIntent({
    config,
    headers: {},
    model: "spec-review",
  });
  assert.equal(intent, "spec-review");
});

test("extractIntent falls back to defaultIntent", () => {
  const config = defaultConfig();
  const intent = extractIntent({
    config,
    headers: {},
    model: "gpt-4o",
  });
  assert.equal(intent, "build");
});

test("resolveRoute maps CodePatrol intents onto coding plans", () => {
  const config = defaultConfig();
  const spec = resolveRoute(config, "spec");
  assert.equal(spec.plan.id, "kimi");
  assert.equal(spec.model, "kimi-k2.5");
  const build = resolveRoute(config, "build");
  assert.equal(build.plan.id, "codex");
  const review = resolveRoute(config, "build-review");
  assert.equal(review.plan.id, "supergrok");
});

test("resolveRoute rejects an unknown intent", () => {
  assert.throws(
    () => resolveRoute(defaultConfig(), "unknown"),
    (err: unknown) => err instanceof ModelpatrolError && err.code === "INTENT_UNKNOWN",
  );
});

test("resolvePlanKey walks fallback env names", () => {
  const plan = defaultConfig().plans.codex;
  assert.ok(plan);
  const key = resolvePlanKey(plan, { OPENAI_API_KEY: "sk-test" });
  assert.equal(key, "sk-test");
});
