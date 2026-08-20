import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { defaultConfig } from "../src/config/defaults.js";
import { readEvents } from "../src/ledger/store.js";
import { startProxy } from "../src/proxy/server.js";

async function listenMock(): Promise<{
  url: string;
  close: () => Promise<void>;
  bodies: unknown[];
}> {
  const bodies: unknown[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => {
      bodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-test",
          model: "upstream-model",
          choices: [{ message: { role: "assistant", content: "ok" } }],
          usage: { prompt_tokens: 12, completion_tokens: 3 },
        }),
      );
    });
  });
  const port = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
  return {
    url: `http://127.0.0.1:${port}/v1`,
    bodies,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

test("proxy routes an intent model to the mapped plan and records usage", async () => {
  const mock = await listenMock();
  const home = mkdtempSync(join(tmpdir(), "modelpatrol-proxy-"));
  const config = defaultConfig();
  const kimi = config.plans.kimi;
  assert.ok(kimi);
  kimi.baseUrl = mock.url;
  const handle = await startProxy({
    home,
    config,
    host: "127.0.0.1",
    port: 0,
    ctx: { env: { MOONSHOT_API_KEY: "test-key" } },
  });
  try {
    const response = await fetch(
      `http://127.0.0.1:${handle.port}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-modelpatrol-harness": "opencode",
        },
        body: JSON.stringify({
          model: "spec",
          messages: [{ role: "user", content: "hi" }],
        }),
      },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-modelpatrol-intent"), "spec");
    assert.equal(response.headers.get("x-modelpatrol-plan"), "kimi");
    const payload = (await response.json()) as { model: string };
    assert.equal(payload.model, "spec");
    const events = readEvents(home);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.intent, "spec");
    assert.equal(events[0]?.plan, "kimi");
    assert.equal(events[0]?.promptTokens, 12);
    assert.equal(events[0]?.completionTokens, 3);
    assert.equal(events[0]?.harness, "opencode");
    const sent = mock.bodies[0] as { model: string };
    assert.equal(sent.model, "kimi-k2.5");
  } finally {
    await handle.close();
    await mock.close();
  }
});

test("GET /health and /v1/usage are local and keyless", async () => {
  const home = mkdtempSync(join(tmpdir(), "modelpatrol-health-"));
  const handle = await startProxy({
    home,
    config: defaultConfig(),
    host: "127.0.0.1",
    port: 0,
  });
  try {
    const health = await fetch(`http://127.0.0.1:${handle.port}/health`);
    assert.equal(health.status, 200);
    const usage = await fetch(`http://127.0.0.1:${handle.port}/v1/usage`);
    const body = (await usage.json()) as { windows: unknown[] };
    assert.equal(body.windows.length, 3);
  } finally {
    await handle.close();
  }
});
