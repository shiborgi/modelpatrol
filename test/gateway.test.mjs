import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createGateway,
  validateConfig,
  route,
  readMetadata,
  Store,
  costFor,
  extractUsage,
} from "../src/index.mjs";
import { StreamMeter } from "../src/usage.mjs";
import { getHarness } from "../src/harnesses.mjs";
import opencode from "../integrations/opencode.mjs";
import piExtension from "../integrations/pi.mjs";

const env = {
  MODELPATROL_API_KEY: "test-gateway-secret-123",
  MODELPATROL_ADMIN_KEY: "test-admin-secret-456",
  UPSTREAM: "upstream-secret",
};
function config(dir, extra = {}) {
  return {
    protocolVersion: "1.0",
    port: 0,
    dataDir: dir,
    providers: {
      test: {
        baseUrl: "https://example.com",
        apiKeyEnv: "UPSTREAM",
        auth: "bearer",
        plan: { kind: "metered" },
      },
    },
    models: [
      {
        id: "cheap",
        provider: "test",
        model: "upstream-cheap",
        apis: ["chat", "responses", "messages"],
        capabilities: ["tools"],
        contextWindow: 32000,
        maxOutputTokens: 1024,
        quality: 0.5,
        pricing: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.2 },
      },
      {
        id: "strong",
        provider: "test",
        model: "upstream-strong",
        apis: ["chat", "responses"],
        capabilities: ["tools", "vision", "reasoning", "json"],
        contextWindow: 64000,
        maxOutputTokens: 4096,
        quality: 0.9,
        pricing: { input: 3, output: 6 },
      },
    ],
    routing: {
      defaultModel: "cheap",
      rules: [
        {
          id: "build",
          match: { step: "build", profile: "react" },
          models: ["strong"],
        },
      ],
    },
    ...extra,
  };
}
async function fixture(t, fetchImpl, extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), "modelpatrol-test-"));
  const gateway = createGateway(config(dir, extra), { env, fetchImpl });
  await new Promise((resolve) =>
    gateway.server.listen(0, "127.0.0.1", resolve),
  );
  t.after(async () => {
    await gateway.close();
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${gateway.server.address().port}`;
  return {
    ...gateway,
    dir,
    base,
    call: (
      body = { model: "auto", messages: [{ role: "user", content: "hello" }] },
      headers = {},
      path = "/v1/chat/completions",
    ) =>
      fetch(base + path, {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.MODELPATROL_API_KEY}`,
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify(body),
      }),
  };
}
const completion = () =>
  Response.json({
    id: "completion",
    choices: [{ message: { role: "assistant", content: "hello" } }],
    usage: { prompt_tokens: 100, completion_tokens: 20 },
  });
test("strict config, unknown providers and secret-bearing URLs are rejected", async () => {
  assert.throws(() => validateConfig({ ...config("."), unknown: true }));
  const c = config(".");
  c.providers.test.baseUrl = "https://user:secret@example.com";
  assert.throws(() => validateConfig(c));
  const sample = JSON.parse(
    await readFile(new URL("../examples/modelpatrol.json", import.meta.url)),
  );
  assert.equal(validateConfig(sample).models.length, 5);
  assert.throws(() => readMetadata({ "x-patrol-agent": "a\nb" }));
  const harness = validateConfig({
    ...config("."),
    providers: {
      subscription: {
        auth: "none",
        transport: { kind: "harness", adapter: "codex" },
        plan: { kind: "subscription", name: "Local harness" },
      },
    },
    models: [
      {
        ...config(".").models[0],
        provider: "subscription",
        apis: ["responses"],
      },
    ],
    routing: { defaultModel: "cheap" },
  });
  assert.equal(harness.providers.subscription.transport.adapter, "codex");
  assert.throws(() =>
    validateConfig({
      ...harness,
      models: [{ ...harness.models[0], apis: ["chat"] }],
    }),
  );
  assert.throws(() =>
    validateConfig({
      ...harness,
      providers: {
        subscription: {
          ...harness.providers.subscription,
          apiKeyEnv: "SHOULD_NOT_EXIST",
        },
      },
    }),
  );
});

test("central harness registry exposes the complete adapter contract", () => {
  for (const id of ["codex", "claude", "opencode", "grok", "antigravity"]) {
    const adapter = getHarness(id);
    assert.equal(typeof adapter.capabilities, "function");
    assert.equal(typeof adapter.invoke, "function");
    assert.equal(typeof adapter.getUsage, "function");
    assert.equal(typeof adapter.health, "function");
    assert.equal(adapter.capabilities().streaming, false);
  }
  assert.throws(() => getHarness("unknown"), /Unknown harness adapter/);
});

test("auto matches profiles, explicit pins model, protocol/capability constraints take priority", () => {
  const c = validateConfig(config("."));
  assert.equal(
    route(c, { model: "auto" }, "chat", {
      step: "build",
      profile: "general,react",
    }).models[0].id,
    "strong",
  );
  assert.equal(
    route(c, { model: "cheap" }, "chat", { step: "build", profile: "react" })
      .models.length,
    1,
  );
  assert.equal(
    route(c, { model: "auto" }, "messages", { step: "build", profile: "react" })
      .models[0].id,
    "cheap",
  );
  assert.throws(() =>
    route(c, { model: "cheap", reasoning_effort: "high" }, "chat", {}),
  );
  assert.throws(() =>
    route(c, { model: "auto", max_tokens: 100000 }, "chat", {}),
  );
});
test("gateway forwards only provider credentials, persists real usage, leaves administration open", async (t) => {
  let captured;
  const f = await fixture(t, async (url, options) => {
    captured = { url, ...options };
    return completion();
  });
  const result = await f.call(undefined, {
    "x-patrol-step": "build",
    "x-patrol-profile": "react",
    "x-patrol-run-id": "run-1",
    "x-untrusted": "secret",
  });
  assert.equal(result.status, 200);
  await result.json();
  assert.equal(JSON.parse(captured.body).model, "upstream-strong");
  assert.deepEqual(Object.keys(captured.headers).sort(), [
    "authorization",
    "content-type",
  ]);
  assert.equal(captured.headers.authorization, "Bearer upstream-secret");
  const events = f.store.events();
  assert.equal(events.length, 1);
  assert.equal(events[0].usage.inputTokens, 100);
  assert.equal(events[0].reason, "rule:build");
  assert.equal(events[0].costUsd, 0.00042);
  assert(!JSON.stringify(events).includes("hello"));
  assert(!JSON.stringify(events).includes("secret"));
  assert.equal((await fetch(f.base + "/admin/requests")).status, 200);
  const metrics = await fetch(f.base + "/admin/metrics?groupBy=step");
  assert.equal((await metrics.json()).groups[0].key, "build");
});
test("SSE passthrough handles split unicode, usage and terminal marker", async (t) => {
  const text =
    'data: {"choices":[{"delta":{"content":"olá"}}]}\n\ndata: {"usage":{"prompt_tokens":12,"completion_tokens":3}}\n\ndata: [DONE]\n\n';
  const bytes = new TextEncoder().encode(text);
  const f = await fixture(
    t,
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            for (const byte of bytes) c.enqueue(new Uint8Array([byte]));
            c.close();
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
  );
  const response = await f.call({ model: "cheap", messages: [], stream: true });
  assert.equal(await response.text(), text);
  const event = f.store.events()[0];
  assert.equal(event.status, "ok");
  assert.equal(event.usage.outputTokens, 3);
});
test("native Responses and Anthropic usage preserve cache accounting", () => {
  const a = extractUsage(
    {
      usage: {
        input_tokens: 10,
        output_tokens: 2,
        cache_read_input_tokens: 50,
        cache_creation_input_tokens: 20,
      },
    },
    "messages",
  );
  assert.equal(
    costFor(
      a,
      { pricing: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.2 } },
      { kind: "metered" },
    ),
    0.000043,
  );
  const b = extractUsage(
    {
      response: {
        usage: {
          input_tokens: 100,
          output_tokens: 5,
          input_tokens_details: { cached_tokens: 50 },
        },
      },
    },
    "responses",
  );
  assert.equal(
    costFor(
      b,
      { pricing: { input: 1, output: 2, cacheRead: 0.1 } },
      { kind: "metered" },
    ),
    0.000065,
  );
  assert.equal(
    costFor(b, { pricing: { input: 1, output: 2 } }, { kind: "metered" }),
    null,
  );
  assert.equal(
    costFor(b, { pricing: { input: 1, output: 2 } }, { kind: "subscription" }),
    null,
  );
  const meter = new StreamMeter("messages");
  meter.push(
    Buffer.from(
      'data: {"type":"message_start","message":{"usage":{"input_tokens":5,"output_tokens":1}}}\n\ndata: {"type":"message_delta","usage":{"output_tokens":8}}\n\ndata: {"type":"message_stop"}\n\n',
    ),
  );
  assert.equal(meter.usage.inputTokens, 5);
  assert.equal(meter.usage.outputTokens, 8);
  assert(meter.complete);
});
test("auto falls back on 429, explicit model and network failures never retry", async (t) => {
  let calls = 0;
  const f = await fixture(t, async () =>
    ++calls === 1 ? new Response("", { status: 429 }) : completion(),
  );
  await (await f.call()).json();
  assert.equal(calls, 2);
  assert.equal(f.store.events()[0].attempts.length, 2);
  const g = await fixture(t, async () => {
    calls++;
    return new Response("", { status: 429 });
  });
  calls = 0;
  assert.equal((await g.call({ model: "cheap" })).status, 429);
  assert.equal(calls, 1);
  const h = await fixture(t, async () => {
    calls++;
    throw new Error("network secret");
  });
  calls = 0;
  const error = await h.call();
  assert.equal(error.status, 502);
  assert.equal(calls, 1);
  assert(!(await error.text()).includes("secret"));
});
test("cache is opt-in, reports no new billed usage, and request limits apply", async (t) => {
  let calls = 0;
  const f = await fixture(
    t,
    async () => {
      calls++;
      return completion();
    },
    { cache: { ttlMs: 60000 } },
  );
  await (await f.call(undefined, { "x-patrol-cache": "true" })).json();
  await (await f.call(undefined, { "x-patrol-cache": "true" })).json();
  assert.equal(calls, 1);
  assert(f.store.events().some((e) => e.cacheHit && e.costUsd === 0));
  const g = await fixture(t, async () => completion(), {
    limits: { requestsPerMinute: 1 },
  });
  await (await g.call()).json();
  assert.equal((await g.call()).status, 429);
});
test("budget prevents dispatch and unknown usage reservations survive reopening storage", async (t) => {
  let calls = 0;
  const f = await fixture(
    t,
    async () => {
      calls++;
      return completion();
    },
    { budgetUsd: 0 },
  );
  assert.equal((await f.call()).status, 402);
  assert.equal(calls, 0);
  const g = await fixture(t, async () => Response.json({ choices: [] }), {
    budgetUsd: 1,
  });
  await (await g.call()).json();
  assert.equal(g.store.events()[0].costUsd, null);
  assert(g.store.monthlyReservations() > 0);
  const reopened = new Store(g.dir);
  assert(reopened.monthlyReservations() > 0);
  reopened.close();
});
test("admin serves a safe static dashboard", async (t) => {
  const f = await fixture(t, async () => completion());
  const page = await fetch(f.base);
  assert.equal(page.status, 200);
  assert(
    page.headers.get("content-security-policy").includes("script-src 'self'"),
  );
});
test("OpenCode and Pi adapters propagate stage metadata to configured gateway", async () => {
  const names = [
    "MODELPATROL_BASE_URL",
    "MODELPATROL_HEADERS",
    "MODELPATROL_API_KEY",
    "MODELPATROL_API",
  ];
  const saved = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  try {
    Object.assign(process.env, {
      MODELPATROL_BASE_URL: "http://127.0.0.1:4318",
      MODELPATROL_HEADERS:
        '{"x-patrol-step":"build","x-patrol-agent":"developer"}',
      MODELPATROL_API_KEY: "test-key",
      MODELPATROL_API: "chat",
    });
    const hooks = await opencode();
    const c = {};
    await hooks.config(c);
    assert.equal(c.model, "modelpatrol/auto");
    assert.equal(
      c.provider.modelpatrol.options.headers["x-patrol-step"],
      "build",
    );
    let registered;
    piExtension({
      registerProvider: (id, config) => {
        registered = { id, config };
      },
    });
    assert.equal(registered.id, "modelpatrol");
    assert.equal(registered.config.headers["x-patrol-agent"], "developer");
    assert.equal(registered.config.api, "openai-completions");
  } finally {
    for (const name of names)
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
  }
});

test("budget reservations prevent concurrent overspend before upstream completion", async (t) => {
  let release;
  let entered;
  const dispatched = new Promise((resolve) => {
    entered = resolve;
  });
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const f = await fixture(
    t,
    async () => {
      entered();
      await wait;
      return completion();
    },
    { budgetUsd: 0.003 },
  );
  const first = f.call();
  await dispatched;
  assert(f.store.monthlyReservations() > 0.002);
  assert.equal(f.store.events()[0].status, "pending");
  try {
    assert.equal((await f.call()).status, 402);
  } finally {
    release();
  }
  assert.equal((await first).status, 200);
  assert.equal(f.store.monthlyReservations(), 0);
});

test("truncated SSE records failure without replaying to another provider", async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => {
    calls++;
    return new Response('data: {"choices":[]}\n\n', {
      headers: { "content-type": "text/event-stream" },
    });
  });
  try {
    const response = await f.call({ model: "auto", stream: true });
    await response.text();
  } catch {
    /* Expected broken stream. */
  }
  assert.equal(calls, 1);
  assert.equal(f.store.events()[0].status, "error");
  assert.equal(f.store.events()[0].usage, null);
});

test("native Messages and Responses dispatch correct paths and authentication", async (t) => {
  const captures = [];
  const f = await fixture(
    t,
    async (url, options) => {
      captures.push({ url, headers: options.headers });
      return Response.json({
        content: [],
        usage: {
          input_tokens: 8,
          output_tokens: 2,
          cache_read_input_tokens: 10,
        },
      });
    },
    {
      providers: {
        test: {
          baseUrl: "https://example.com",
          apiKeyEnv: "UPSTREAM",
          auth: "anthropic",
        },
      },
    },
  );
  assert.equal(
    (await f.call({ model: "cheap", messages: [] }, {}, "/v1/messages")).status,
    200,
  );
  assert.equal(captures[0].url, "https://example.com/v1/messages");
  assert.equal(captures[0].headers["x-api-key"], "upstream-secret");
  assert.equal(f.store.events()[0].usage.inputTokens, 18);
  assert.equal(
    (await f.call({ model: "strong", input: "hello" }, {}, "/v1/responses"))
      .status,
    200,
  );
  assert.equal(captures[1].url, "https://example.com/v1/responses");
  const before = captures.length;
  await f.call(
    { model: "auto", previous_response_id: "provider-state" },
    {},
    "/v1/responses",
  );
  assert.equal(captures.length, before);
});
