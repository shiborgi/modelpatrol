import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { readCredential, writeCredential } from "../src/auth/store.js";
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

test("resolvePlanKey walks fallback env names", async () => {
  const plan = defaultConfig().plans.codex;
  assert.ok(plan);
  const key = await resolvePlanKey(plan, { OPENAI_API_KEY: "sk-test" });
  assert.equal(key, "sk-test");
});

test("resolvePlanKey prefers env over stored oauth", async () => {
  const home = mkdtempSync(join(tmpdir(), "modelpatrol-key-"));
  try {
    const plan = defaultConfig().plans.supergrok;
    assert.ok(plan);
    writeCredential(home, "supergrok", {
      access: "stored-token",
      refresh: "r",
      expires: Date.now() + 1_000_000,
    });
    const key = await resolvePlanKey(plan, { SUPERGROK_API_KEY: "env-key" }, home);
    assert.equal(key, "env-key");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("resolvePlanKey uses stored oauth and throws when both missing", async () => {
  const home = mkdtempSync(join(tmpdir(), "modelpatrol-key-"));
  try {
    const plan = defaultConfig().plans.supergrok;
    assert.ok(plan);
    writeCredential(home, "supergrok", {
      access: "oauth-token",
      refresh: "r",
      expires: Date.now() + 1_000_000,
    });
    const key = await resolvePlanKey(plan, {}, home);
    assert.equal(key, "oauth-token");
    await assert.rejects(
      () => resolvePlanKey(plan, {}, `${home}-empty`),
      (err: unknown) =>
        err instanceof ModelpatrolError && err.code === "PLAN_UNAUTHENTICATED",
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("resolvePlanKey single-flight refresh keeps omitted refresh token", async () => {
  const home = mkdtempSync(join(tmpdir(), "modelpatrol-refresh-"));
  try {
    const plan = defaultConfig().plans.supergrok;
    assert.ok(plan);
    writeCredential(home, "supergrok", {
      access: "old-access",
      refresh: "keep-me",
      expires: Date.now() + 1000,
    });
    let calls = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      await gate;
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "new-access", expires_in: 3600 }),
        text: async () => "",
        headers: new Headers(),
      } as Response;
    };
    const first = resolvePlanKey(plan, {}, home, { fetchImpl });
    const second = resolvePlanKey(plan, {}, home, { fetchImpl });
    release();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(calls, 1);
    assert.equal(a, "new-access");
    assert.equal(b, "new-access");
    const stored = readCredential(home, "supergrok");
    assert.equal(stored?.refresh, "keep-me");
    assert.equal(stored?.access, "new-access");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
