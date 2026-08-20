import assert from "node:assert/strict";
import { test } from "node:test";

import { CATALOG, requireLevel, resolveCatalogRoute } from "../src/catalog/catalog.js";
import { ModelpatrolError } from "../src/core/errors.js";
import { extractProviderModelLevel, parseModelSlug } from "../src/routing/intent.js";

test("catalog lists xai and openai with their models", () => {
  assert.deepEqual(Object.keys(CATALOG).sort(), ["openai", "xai"]);
  assert.deepEqual(
    CATALOG.xai?.models.map((m) => m.id),
    ["grok-4.6", "grok-build-0.1"],
  );
  assert.deepEqual(
    CATALOG.openai?.models.map((m) => m.id),
    ["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra"],
  );
});

test("each model lists default/high/max with a reasoning value", () => {
  for (const provider of Object.values(CATALOG)) {
    for (const model of provider.models) {
      assert.deepEqual(
        model.levels.map((l) => l.id),
        ["default", "high", "max"],
      );
      for (const level of model.levels) {
        if (level.id === "default") {
          assert.equal(level.reasoning, null);
        } else {
          assert.equal(typeof level.reasoning, "string");
        }
      }
    }
  }
});

test("xAI max falls back to high for grok-build-0.1", () => {
  const xai = CATALOG.xai;
  assert.ok(xai);
  const route = resolveCatalogRoute(CATALOG, "xai", "grok-build-0.1", "max");
  assert.equal(route.reasoning, "high");
  const fourSix = resolveCatalogRoute(CATALOG, "xai", "grok-4.6", "max");
  assert.equal(fourSix.reasoning, "xhigh");
});

test("resolveCatalogRoute builds a plan from provider fields", () => {
  const xai = resolveCatalogRoute(CATALOG, "xai", "grok-4.6");
  assert.equal(xai.plan.baseUrl, "https://api.x.ai/v1");
  assert.equal(xai.plan.authEnv, "XAI_API_KEY");
  assert.equal(xai.plan.oauthPlan, "supergrok");
  assert.equal(xai.level, "default");
  assert.equal(xai.reasoning, null);

  const openai = resolveCatalogRoute(CATALOG, "openai", "gpt-5.6-sol", "high");
  assert.equal(openai.plan.baseUrl, "https://api.openai.com/v1");
  assert.equal(openai.plan.authEnv, "OPENAI_API_KEY");
  assert.equal(openai.reasoning, "high");
});

test("resolveCatalogRoute throws on unknown provider/model/level", () => {
  assert.throws(
    () => resolveCatalogRoute(CATALOG, "nope", "grok-4.6"),
    (err: unknown) =>
      err instanceof ModelpatrolError && err.code === "PROVIDER_UNKNOWN",
  );
  assert.throws(
    () => resolveCatalogRoute(CATALOG, "xai", "nope"),
    (err: unknown) => err instanceof ModelpatrolError && err.code === "MODEL_UNKNOWN",
  );
  assert.throws(
    () => resolveCatalogRoute(CATALOG, "xai", "grok-4.6", "ultra"),
    (err: unknown) => err instanceof ModelpatrolError && err.code === "USAGE",
  );
  assert.throws(
    () => requireLevel(CATALOG.xai!.models[0]!, "ultra"),
    (err: unknown) => err instanceof ModelpatrolError && err.code === "USAGE",
  );
});

test("extractProviderModelLevel reads headers first", () => {
  const fromHeaders = extractProviderModelLevel({
    headers: {
      "x-modelpatrol-provider": "xai",
      "x-modelpatrol-model": "grok-4.6",
      "x-modelpatrol-level": "high",
    },
    model: "openai/gpt-5.6-sol",
  });
  assert.deepEqual(fromHeaders, { provider: "xai", model: "grok-4.6", level: "high" });
});

test("extractProviderModelLevel falls back to body model slug", () => {
  assert.deepEqual(parseModelSlug("xai/grok-4.6"), {
    provider: "xai",
    model: "grok-4.6",
  });
  assert.deepEqual(parseModelSlug("openai/gpt-5.6-terra/max"), {
    provider: "openai",
    model: "gpt-5.6-terra",
    level: "max",
  });
  assert.equal(parseModelSlug("gpt-4o"), null);
  const fromSlug = extractProviderModelLevel({ headers: {}, model: "xai/grok-4.6" });
  assert.deepEqual(fromSlug, { provider: "xai", model: "grok-4.6" });
  const none = extractProviderModelLevel({ headers: {}, model: "build" });
  assert.equal(none, null);
});
