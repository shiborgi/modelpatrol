import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { centralUsage } from "./central-usage.mjs";

function prompt(body, api) {
  if (api === "responses") {
    if (typeof body.input === "string") return body.input;
    const parts = (body.input ?? []).flatMap((item) => item.content ?? item)
      .filter((item) => typeof item === "string" || item?.type === "input_text")
      .map((item) => typeof item === "string" ? item : item.text);
    if (parts.length) return parts.join("\n");
  }
  const parts = (body.messages ?? []).filter((item) => item.role === "user")
    .map((item) => typeof item.content === "string" ? item.content : "")
    .filter(Boolean);
  if (!parts.length) throw new Error("Harness requests require user text");
  return parts.join("\n");
}

function run(command, args, { cwd, env, signal, timeoutMs = 120000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const out = [], err = [];
    let done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
      child.kill();
      error ? reject(error) : resolve(value);
    };
    const aborted = () => finish(new Error("Harness request aborted"));
    const timer = setTimeout(() => finish(new Error(`${command} timed out`)), timeoutMs);
    timer.unref();
    signal?.addEventListener("abort", aborted, { once: true });
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => err.push(chunk));
    child.once("error", finish);
    child.once("close", (code) => code
      ? finish(new Error(Buffer.concat(err).toString() || `${command} exited ${code}`))
      : finish(null, Buffer.concat(out).toString().trim()));
  });
}

function codexTurn(input, model, options) {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "pipe"], env: options.env });
    let buffer = "", next = 1, answer = "", done = false;
    const pending = new Map();
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", aborted);
      child.kill();
      error ? reject(error) : resolve(value);
    };
    const aborted = () => finish(new Error("Codex request aborted"));
    const call = (method, params) => new Promise((ok, fail) => {
      const id = next++;
      pending.set(id, { ok, fail });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      while (buffer.includes("\n")) {
        const at = buffer.indexOf("\n"), line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.id !== undefined) {
          const request = pending.get(message.id);
          if (!request) continue;
          pending.delete(message.id);
          message.error ? request.fail(new Error(message.error.message)) : request.ok(message.result);
        } else if (message.method === "item/completed" && message.params?.item?.type === "agentMessage") {
          answer = message.params.item.text;
        } else if (message.method === "turn/completed") {
          message.params?.turn?.status === "completed"
            ? finish(null, answer || "No text response was returned by Codex")
            : finish(new Error(message.params?.turn?.error?.message || "Codex turn failed"));
        }
      }
    });
    child.once("error", finish);
    const timer = setTimeout(() => finish(new Error("Codex turn timed out")), 120000);
    timer.unref();
    options.signal?.addEventListener("abort", aborted, { once: true });
    (async () => {
      try {
        await call("initialize", { clientInfo: { name: "modelpatrol", version: "1.0" } });
        child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
        const thread = await call("thread/start", { model });
        const threadId = thread.thread?.id ?? thread.id;
        await call("turn/start", { threadId, input: [{ type: "text", text: input }], cwd: options.cwd, model, approvalPolicy: "never", sandboxPolicy: { type: "readOnly", networkAccess: false } });
      } catch (error) { finish(error); }
    })();
  });
}

const adapters = {
  codex: {
    capabilities: () => ({ apis: ["responses"], streaming: false }),
    invoke: (input, model, options) => codexTurn(input, model, options),
  },
  claude: {
    capabilities: () => ({ apis: ["messages"], streaming: false }),
    invoke: async (input, model, options) => {
      const reply = JSON.parse(await run("claude", ["-p", input, "--output-format", "json", "--permission-mode", "plan", "--max-turns", "1", "--model", model], options));
      if (reply.is_error || typeof reply.result !== "string") throw new Error(reply.result || "Claude request failed");
      return reply.result;
    },
  },
  opencode: {
    capabilities: () => ({ apis: ["responses"], streaming: false }),
    invoke: (input, model, options) => run("opencode", ["run", input, "--model", model.includes("/") ? model : `opencode/${model}`, "--agent", "plan", "--dir", options.cwd], options),
  },
  grok: {
    capabilities: () => ({ apis: ["chat"], streaming: false }),
    invoke: async (input, model, options) => {
      const reply = JSON.parse(await run("grok", ["-p", input, "--output-format", "json", "--permission-mode", "plan", "--max-turns", "10", "--model", model], options));
      if (reply.type === "error" || typeof reply.text !== "string" || !reply.text) throw new Error(reply.message || "Grok request failed");
      return reply.text;
    },
  },
  antigravity: {
    capabilities: () => ({ apis: ["chat"], streaming: false }),
    invoke: async (input, model, options) => {
      const reply = JSON.parse(await run("agy", ["-p", input, "--output-format", "json", "--mode", "plan", "--model", model], options));
      if (reply.status !== "SUCCESS" || typeof reply.response !== "string" || !reply.response) throw new Error(reply.message || "Antigravity request failed");
      return { text: reply.response, usage: reply.usage };
    },
  },
};

export const harnessIds = Object.freeze(Object.keys(adapters));

export function hasHarness(id) {
  return Object.hasOwn(adapters, id);
}

export function getHarness(id) {
  if (!hasHarness(id)) throw new Error("Unknown harness adapter");
  const adapter = adapters[id];
  return {
    ...adapter,
    getUsage: (provider, env) => centralUsage({ ...provider, id }, env),
    health: () => ({ available: true, adapter: id }),
  };
}

export async function invokeHarness(provider, api, body, { env = process.env, signal } = {}) {
  if (body.stream) throw new Error("Streaming is not supported by local harnesses");
  const adapter = getHarness(provider.transport.adapter);
  if (!adapter.capabilities().apis.includes(api)) throw new Error("Harness does not support this API");
  const configured = provider.transport.workspaceEnv && env[provider.transport.workspaceEnv];
  if (configured && !isAbsolute(configured)) throw new Error("Harness workspace must be absolute");
  const temporary = configured ? null : await mkdtemp(join(tmpdir(), "modelpatrol-harness-"));
  const cwd = configured ?? temporary;
  try {
    const value = await adapter.invoke(prompt(body, api), body.model, { cwd, env, signal });
    const result = typeof value === "string" ? { text: value } : value;
    if (api === "chat") return { id: `modelpatrol-${provider.transport.adapter}-${Date.now()}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: body.model, choices: [{ index: 0, message: { role: "assistant", content: result.text }, finish_reason: "stop" }], ...(result.usage ? { usage: { prompt_tokens: result.usage.input_tokens, completion_tokens: result.usage.output_tokens, prompt_tokens_details: { cached_tokens: result.usage.cache_read_tokens ?? 0 } } } : {}) };
    if (api === "messages") return { id: `modelpatrol-${provider.transport.adapter}-${Date.now()}`, type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: result.text }], stop_reason: "end_turn" };
    return { id: `modelpatrol-${provider.transport.adapter}-${Date.now()}`, object: "response", status: "completed", model: body.model, output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: result.text }] }], output_text: result.text };
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}

/** Convert a completed local Chat harness response into one buffered SSE turn. */
export function harnessChatSse(result) {
  const choice = result?.choices?.[0];
  const text = choice?.message?.content;
  if (typeof text !== "string" || !text)
    throw new Error("Harness Chat response has no assistant text");
  const base = {
    id: result.id,
    object: "chat.completion.chunk",
    created: result.created,
    model: result.model,
  };
  const content = {
    ...base,
    choices: [
      {
        index: 0,
        delta: { role: "assistant", content: text },
        finish_reason: null,
      },
    ],
  };
  const completed = {
    ...base,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    ...(result.usage ? { usage: result.usage } : {}),
  };
  return `data: ${JSON.stringify(content)}\n\ndata: ${JSON.stringify(completed)}\n\ndata: [DONE]\n\n`;
}
