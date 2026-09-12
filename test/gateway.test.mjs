import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
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
import {
  getHarness,
  harnessChatSse,
  harnessCompletionText,
  harnessCwd,
  harnessPrompt,
  structuredOutputSchema,
  chatFunctionTools,
  cliJsonSchema,
  antigravityChatStream,
  claudeChatStream,
  codexChatStream,
  grokChatStream,
  opencodeChatStream,
} from "../src/harnesses.mjs";
import opencode from "../integrations/opencode/index.mjs";
import piExtension from "../integrations/pi/index.mjs";

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

function fakeChild() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  return child;
}

async function streamedChat(stream) {
  const text = await new Response(stream).text();
  const meter = new StreamMeter("chat");
  meter.push(new TextEncoder().encode(text));
  const payloads = text
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice(6)));
  return {
    text,
    meter,
    payloads,
    content: payloads
      .map((payload) => payload.choices[0].delta.content ?? "")
      .join(""),
  };
}
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
  assert.equal(
    readMetadata({ "x-patrol-workspace": "/tmp/codepatrol-worktree" }).workspace,
    "/tmp/codepatrol-worktree",
  );
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
  assert.deepEqual(
    validateConfig({
      ...harness,
      models: [{ ...harness.models[0], apis: ["chat", "responses"] }],
    }).models[0].apis,
    ["chat", "responses"],
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
    assert.equal(adapter.capabilities().streaming, true);
    assert(adapter.capabilities().apis.includes("chat"));
  }
  assert.throws(() => getHarness("unknown"), /Unknown harness adapter/);
});

test("harness cwd prefers an explicit worktree over the operator project", () => {
  assert.equal(
    harnessCwd({
      requested: "/tmp/stage-worktree",
      configured: "/tmp/operator-project",
      isolate: true,
    }),
    "/tmp/stage-worktree",
  );
  assert.equal(
    harnessCwd({
      requested: undefined,
      configured: "/tmp/operator-project",
      isolate: true,
    }),
    undefined,
  );
  assert.equal(
    harnessCwd({
      requested: undefined,
      configured: "/tmp/operator-project",
      isolate: false,
    }),
    "/tmp/operator-project",
  );
  assert.throws(
    () => harnessCwd({ requested: "relative", configured: undefined, isolate: false }),
    /absolute/,
  );
});

test("harness prompts accept OpenAI content parts used by Pi", () => {
  assert.equal(
    harnessPrompt(
      {
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Reply with exactly ping" }],
          },
        ],
      },
      "chat",
    ),
    "Reply with exactly ping",
  );
  assert.equal(
    harnessPrompt({ messages: [{ role: "user", content: "plain" }] }, "chat"),
    "plain",
  );
  const constrained = harnessPrompt(
    { messages: [{ role: "user", content: "finish" }] },
    "chat",
    {
      type: "object",
      properties: { status: { enum: ["passed", "failed"] } },
      required: ["status"],
      additionalProperties: false,
    },
  );
  assert(constrained.startsWith("finish\n\nThe transport cannot return"));
  assert(constrained.endsWith('"additionalProperties":false}'));
  assert.throws(
    () => harnessPrompt({ messages: [{ role: "user", content: [] }] }, "chat"),
    /user text/,
  );
});

test("harness structured output prefers codepatrol_result schema and objects", () => {
  const tools = chatFunctionTools({
    tools: [
      {
        type: "function",
        function: {
          name: "read",
          parameters: { type: "object", properties: { path: { type: "string" } } },
        },
      },
      {
        type: "function",
        function: {
          name: "codepatrol_result",
          parameters: {
            type: "object",
            properties: { status: { type: "string" } },
            required: ["status"],
          },
        },
      },
    ],
  });
  assert.equal(tools[1].name, "codepatrol_result");
  assert.deepEqual(structuredOutputSchema(tools).required, ["status"]);
  assert.deepEqual(structuredOutputSchema(tools, "spec").required, ["status"]);
  assert.deepEqual(structuredOutputSchema(tools, "spec-review").required, [
    "status",
    "approved",
  ]);
  assert.equal(structuredOutputSchema(tools, "ship").properties.approved.type, "boolean");
  assert.equal(
    harnessCompletionText({
      response: "I'll read the file first.\n",
      structured_output: { protocolVersion: "1.0", status: "passed" },
    }),
    JSON.stringify({ protocolVersion: "1.0", status: "passed" }),
  );
  assert.equal(
    harnessCompletionText({ text: "{\n  \"status\": \"passed\"\n}" }),
    JSON.stringify({ status: "passed" }),
  );
  assert.deepEqual(
    cliJsonSchema({
      type: "object",
      properties: {
        protocolVersion: { type: "string", const: "1.0" },
        status: {
          anyOf: [
            { type: "string", const: "passed" },
            { type: "string", const: "failed" },
          ],
        },
      },
    }),
    {
      type: "object",
      properties: {
        protocolVersion: { type: "string", enum: ["1.0"] },
        status: { type: "string", enum: ["passed", "failed"] },
      },
    },
  );
});

test("completed local Chat harness results become honest buffered SSE", () => {
  const text = harnessChatSse({
    id: "harness-1",
    created: 1,
    model: "fixture",
    choices: [
      { message: { role: "assistant", content: "done" }, finish_reason: "stop" },
    ],
  });
  const meter = new StreamMeter("chat");
  meter.push(new TextEncoder().encode(text));
  assert.equal(meter.complete, true);
  const payloads = text
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice(6)));
  assert.equal(payloads[0].choices[0].delta.content, "done");
  assert.equal(payloads[1].choices[0].finish_reason, "stop");
  assert.equal(payloads[1].usage, undefined);
});

test("Antigravity NDJSON becomes incremental Chat SSE with terminal usage", async () => {
  let args;
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  const result = {
    protocolVersion: "1.0",
    status: "passed",
    summary: "ação concluída",
    artifacts: [],
  };
  const response = JSON.stringify(result);
  const stream = antigravityChatStream("prompt", "claude-sonnet", {
    cwd: "/tmp/worktree",
    env: {},
    step: "build",
    timeoutMs: 12_345,
    schema: { type: "object" },
    spawnImpl: (_command, invocation) => {
      args = invocation;
      queueMicrotask(() => {
        const events = [
          JSON.stringify({ event: "init", init: { cwd: "/tmp/worktree" } }),
          JSON.stringify({
            event: "step_update",
            step_update: {
              step_type: "agent_response",
              state: "ACTIVE",
              text_delta: response.slice(0, 20),
            },
          }),
          JSON.stringify({
            event: "step_update",
            step_update: {
              step_type: "agent_response",
              state: "DONE",
              text_delta: response.slice(20),
            },
          }),
          JSON.stringify({
            event: "result",
            result: {
              status: "SUCCESS",
              response,
              structured_output: result,
              usage: {
                input_tokens: 12,
                output_tokens: 7,
                cache_read_tokens: 3,
              },
            },
          }),
        ].join("\n");
        const bytes = Buffer.from(`${events}\n`);
        child.stdout.write(bytes.subarray(0, 73));
        child.stdout.write(bytes.subarray(73));
      });
      return child;
    },
  });
  const text = await new Response(stream).text();
  const meter = new StreamMeter("chat");
  meter.push(new TextEncoder().encode(text));
  assert.equal(meter.complete, true);
  assert.deepEqual(meter.usage, {
    inputTokens: 12,
    outputTokens: 7,
    cacheReadTokens: 3,
    cacheWriteTokens: 0,
    inputIncludesCache: true,
  });
  const payloads = text
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice(6)));
  assert.equal(
    payloads.map((payload) => payload.choices[0].delta.content ?? "").join(""),
    response,
  );
  assert(args.includes("stream-json"));
  assert(args.includes("accept-edits"));
  assert(args.includes("13s"));
});

test("Claude stream-json becomes incremental Chat SSE", async () => {
  let args;
  const child = fakeChild();
  const result = { status: "passed", summary: "concluído" };
  const response = JSON.stringify(result);
  const streamedResponse = `${response}\n`;
  const stream = claudeChatStream("prompt", "sonnet", {
    cwd: "/tmp/worktree",
    env: {},
    step: "build",
    schema: { type: "object" },
    spawnImpl: (_command, invocation) => {
      args = invocation;
      queueMicrotask(() => {
        child.stdout.write(
          `${JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: streamedResponse.slice(0, 12) } } })}\n`,
        );
        child.stdout.write(
          `${JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: streamedResponse.slice(12) } } })}\n`,
        );
        child.stdout.write(
          `${JSON.stringify({ type: "result", subtype: "success", result: response, structured_output: result, usage: { input_tokens: 9, output_tokens: 4 } })}\n`,
        );
      });
      return child;
    },
  });
  const parsed = await streamedChat(stream);
  assert.equal(parsed.content, streamedResponse);
  assert.equal(parsed.meter.complete, true);
  assert.deepEqual(parsed.meter.usage, {
    inputTokens: 9,
    outputTokens: 4,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    inputIncludesCache: true,
  });
  assert(args.includes("stream-json"));
  assert(args.includes("--verbose"));
  assert(args.includes("--include-partial-messages"));
  assert(args.includes("acceptEdits"));
  assert(args.includes("--json-schema"));
});

test("Grok streaming Messages NDJSON becomes incremental Chat SSE", async () => {
  let args;
  const child = fakeChild();
  const response = '{"status":"passed"}';
  const stream = grokChatStream("prompt", "grok-4.6", {
    cwd: "/tmp/worktree",
    env: {},
    step: "plan",
    schema: { type: "object" },
    spawnImpl: (_command, invocation) => {
      args = invocation;
      queueMicrotask(() => {
        const records = [
          {
            type: "message_start",
            message: { usage: { input_tokens: 11, output_tokens: 0 } },
          },
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: response.slice(0, 10) },
          },
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: response.slice(10) },
          },
          { type: "message_delta", usage: { output_tokens: 5 } },
          { type: "message_stop" },
        ];
        child.stdout.end(`${records.map((item) => JSON.stringify(item)).join("\n")}\n`);
      });
      return child;
    },
  });
  const parsed = await streamedChat(stream);
  assert.equal(parsed.content, response);
  assert.equal(parsed.meter.complete, true);
  assert.equal(parsed.meter.usage.inputTokens, 11);
  assert.equal(parsed.meter.usage.outputTokens, 5);
  assert(args.includes("streaming-messages-json"));
  assert(args.includes("--include-partial-messages"));
  assert(args.includes("plan"));
  assert(!args.includes("--json-schema"));
});

test("Codex app-server deltas become incremental Chat SSE", async () => {
  let invocation;
  const child = fakeChild();
  const response = '{"status":"passed"}';
  let stdin = "";
  const requests = [];
  child.stdin.on("data", (chunk) => {
    stdin += chunk;
    let newline = stdin.indexOf("\n");
    while (newline >= 0) {
      const line = stdin.slice(0, newline);
      stdin = stdin.slice(newline + 1);
      newline = stdin.indexOf("\n");
      const message = JSON.parse(line);
      if (message.id === undefined) continue;
      requests.push(message);
      const result =
        message.method === "thread/start"
          ? { thread: { id: "thread-1" } }
          : message.method === "turn/start"
            ? { turn: { id: "turn-1" } }
            : {};
      child.stdout.write(`${JSON.stringify({ id: message.id, result })}\n`);
      if (message.method === "turn/start") {
        queueMicrotask(() => {
          child.stdout.write(
            `${JSON.stringify({ method: "item/agentMessage/delta", params: { itemId: "item-1", delta: response.slice(0, 8) } })}\n`,
          );
          child.stdout.write(
            `${JSON.stringify({ method: "item/agentMessage/delta", params: { itemId: "item-1", delta: response.slice(8) } })}\n`,
          );
          child.stdout.write(
            `${JSON.stringify({ method: "item/completed", params: { item: { type: "agentMessage", text: response } } })}\n`,
          );
          child.stdout.write(
            `${JSON.stringify({ method: "thread/tokenUsage/updated", params: { tokenUsage: { last: { inputTokens: 13, outputTokens: 6, cachedInputTokens: 2 } } } })}\n`,
          );
          child.stdout.write(
            `${JSON.stringify({ method: "turn/completed", params: { turn: { status: "completed" } } })}\n`,
          );
        });
      }
    }
  });
  const stream = codexChatStream("prompt", "gpt-5.6-terra", {
    cwd: "/tmp/worktree",
    env: {},
    step: "build",
    schema: { type: "object" },
    spawnImpl: (_command, args) => {
      invocation = args;
      return child;
    },
  });
  const parsed = await streamedChat(stream);
  assert.equal(parsed.content, response);
  assert.equal(parsed.meter.complete, true);
  assert.equal(parsed.meter.usage.cacheReadTokens, 2);
  assert.deepEqual(invocation, ["app-server"]);
  const turn = requests.find((item) => item.method === "turn/start");
  assert.equal(turn.params.sandboxPolicy.type, "workspaceWrite");
  assert.deepEqual(turn.params.outputSchema, { type: "object" });
});

test("OpenCode run NDJSON becomes Chat SSE without another listener", async () => {
  const child = fakeChild();
  const first = '{"status":';
  const response = `${first}"passed"}`;
  const records = [
    {
      type: "text",
      part: { id: "part-1", type: "text", text: first },
    },
    {
      type: "step_finish",
      part: {
        reason: "tool-calls",
        tokens: { input: 8, output: 2, cache: { read: 1, write: 0 } },
      },
    },
    {
      type: "text",
      part: { id: "part-1", type: "text", text: '"passed"}' },
    },
    {
      type: "step_finish",
      part: {
        tokens: { input: 15, output: 7, cache: { read: 3, write: 0 } },
      },
    },
  ];
  let invocation;
  const stream = opencodeChatStream("prompt", "opencode/muse-spark-1.3", {
    cwd: "/tmp/worktree",
    env: {},
    step: "plan",
    schema: { type: "object" },
    spawnImpl: (command, args) => {
      invocation = { command, args };
      queueMicrotask(() => {
        child.stdout.end(records.map((item) => JSON.stringify(item)).join("\n"));
        child.emit("close", 0);
      });
      return child;
    },
  });
  const parsed = await streamedChat(stream);
  assert.equal(parsed.content, response);
  assert.equal(parsed.meter.complete, true);
  assert.equal(parsed.meter.usage.inputTokens, 15);
  assert.equal(parsed.meter.usage.cacheReadTokens, 3);
  assert.equal(invocation.command, "opencode");
  assert.deepEqual(invocation.args, [
    "run",
    "prompt",
    "--model",
    "opencode/muse-spark-1.3",
    "--agent",
    "plan",
    "--dir",
    "/tmp/worktree",
    "--format",
    "json",
    "--pure",
  ]);
  assert(!invocation.args.includes("serve"));
  assert(!invocation.args.includes("--port"));

  let buildArgs;
  const buildStream = opencodeChatStream("build", "gpt-5.6-luna", {
    cwd: "/tmp/worktree",
    env: {},
    step: "build",
    spawnImpl: (_command, args) => {
      buildArgs = args;
      return fakeChild();
    },
  });
  await buildStream.cancel();
  assert(buildArgs.includes("build"));
  assert(buildArgs.includes("--auto"));
  assert(buildArgs.includes("opencode/gpt-5.6-luna"));
});

test("native harness stream cancellation kills the child and cleans temporary state", async () => {
  const child = fakeChild();
  let killed = 0;
  let cleaned = 0;
  child.kill = () => {
    killed += 1;
    return true;
  };
  const stream = claudeChatStream("prompt", "sonnet", {
    cwd: "/tmp/worktree",
    env: {},
    step: "plan",
    timeoutMs: 60_000,
    cleanup: async () => {
      cleaned += 1;
    },
    spawnImpl: () => child,
  });
  await stream.getReader().cancel();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(killed, 1);
  assert.equal(cleaned, 1);
});

test("native harness timeout fails without dispatching another process", async () => {
  const child = fakeChild();
  let spawned = 0;
  let killed = 0;
  child.kill = () => {
    killed += 1;
    return true;
  };
  const stream = claudeChatStream("prompt", "sonnet", {
    cwd: "/tmp/worktree",
    env: {},
    step: "plan",
    timeoutMs: 5,
    spawnImpl: () => {
      spawned += 1;
      return child;
    },
  });
  const keepalive = setTimeout(() => {}, 100);
  try {
    await assert.rejects(new Response(stream).text(), /Claude timed out/);
  } finally {
    clearTimeout(keepalive);
  }
  assert.equal(spawned, 1);
  assert.equal(killed, 1);
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

test("local Chat routing can select every configured CodePatrol model", async () => {
  const local = validateConfig(
    JSON.parse(
      await readFile(
        new URL("../deploy/modelpatrol.local.json", import.meta.url),
      ),
    ),
  );
  const selection = route(
    local,
    {
      model: "auto",
      messages: [{ role: "user", content: "plan" }],
      tools: [
        {
          type: "function",
          function: {
            name: "codepatrol_result",
            parameters: { type: "object" },
          },
        },
      ],
    },
    "chat",
    { step: "plan" },
  );
  for (const id of [
    "claude/coder",
    "codex/coder",
    "opencode/coder",
    "grok/coder",
    "ollama/coder",
  ])
    assert(selection.models.some((model) => model.id === id), `${id} is eligible`);
  assert.equal(
    selection.models.find((model) => model.id === "opencode/coder")?.model,
    "muse-spark-1.3-contributor-free",
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
test("routing failures persist a sanitized reason without raw provider text", async (t) => {
  const f = await fixture(t, async () => completion());
  const error = await f.call({ model: "auto", max_tokens: 100000 });
  assert.equal(error.status, 502);
  const body = await error.json();
  assert.equal(body.error.message, "No compatible model is available");
  assert.equal(f.store.events()[0].failure, "No compatible model is available");
  assert.equal(f.store.events()[0].attempts.length, 0);
  assert.equal(f.store.events()[0].model, undefined);
  const zero = await f.call({ model: "auto", max_tokens: 0 });
  assert.equal((await zero.json()).error.message, "Invalid output token limit");
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
  const body = await error.text();
  assert(!body.includes("secret"));
  assert(body.includes("Request failed validation or provider execution"));
  assert.equal(
    h.store.events()[0].failure,
    "Request failed validation or provider execution",
  );
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
    "MODELPATROL_CONTEXT_WINDOW",
    "MODELPATROL_MAX_OUTPUT_TOKENS",
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
      MODELPATROL_CONTEXT_WINDOW: "1048576",
      MODELPATROL_MAX_OUTPUT_TOKENS: "131072",
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
    assert.equal(registered.config.models[0].contextWindow, 1048576);
    assert.equal(registered.config.models[0].maxTokens, 131072);
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

test("stream failures before the first frame return a bounded gateway error", async (t) => {
  const f = await fixture(t, async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          queueMicrotask(() => controller.error(new Error("secret provider failure")));
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    ),
  );
  const response = await f.call({ model: "cheap", stream: true });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.error.message, "Request failed validation or provider execution");
  assert(!JSON.stringify(body).includes("secret provider failure"));
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
