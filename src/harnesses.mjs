import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { tmpdir } from "node:os";
import { centralUsage } from "./central-usage.mjs";

function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (typeof item === "string") return item;
      if (!item || typeof item !== "object") return "";
      if (
        (item.type === "text" || item.type === "input_text") &&
        typeof item.text === "string"
      )
        return item.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function chatFunctionTools(body) {
  if (!Array.isArray(body?.tools)) return [];
  const tools = [];
  for (const tool of body.tools) {
    const fn =
      tool && typeof tool === "object" && tool.type === "function"
        ? tool.function
        : undefined;
    if (!fn || typeof fn !== "object" || typeof fn.name !== "string" || !fn.name)
      continue;
    tools.push({
      name: fn.name,
      description: typeof fn.description === "string" ? fn.description : "",
      parameters:
        fn.parameters && typeof fn.parameters === "object" && !Array.isArray(fn.parameters)
          ? fn.parameters
          : undefined,
    });
  }
  return tools;
}

export function requiresApproval(step) {
  return typeof step === "string" && (step.endsWith("-review") || step === "ship");
}

/** Prefer CodePatrol's completion tool; otherwise a single function tool. */
export function structuredOutputSchema(tools, step) {
  const selected =
    tools.find((tool) => tool.name === "codepatrol_result") ??
    (tools.length === 1 ? tools[0] : undefined);
  const parameters = selected?.parameters;
  if (!parameters) return undefined;
  const schema = structuredClone(parameters);
  if (requiresApproval(step)) {
    schema.properties = {
      ...(schema.properties && typeof schema.properties === "object" ? schema.properties : {}),
      approved: { type: "boolean" },
    };
    const required = Array.isArray(schema.required) ? [...schema.required] : [];
    if (!required.includes("approved")) required.push("approved");
    schema.required = required;
  }
  return schema;
}

function chatUsage(usage) {
  if (!usage || typeof usage !== "object") return undefined;
  const input = usage.input_tokens ?? usage.inputTokens ?? usage.input;
  const output = usage.output_tokens ?? usage.outputTokens ?? usage.output;
  const cached =
    usage.cache_read_tokens ??
    usage.cache_read_input_tokens ??
    usage.cached_input_tokens ??
    usage.cachedInputTokens ??
    usage.cacheReadTokens ??
    usage.cache?.read ??
    0;
  if (![input, output].every((value) => Number.isSafeInteger(value) && value >= 0))
    return undefined;
  return {
    prompt_tokens: input,
    completion_tokens: output,
    prompt_tokens_details: {
      cached_tokens:
        Number.isSafeInteger(cached) && cached >= 0 ? cached : 0,
    },
  };
}

function chatChunk(base, delta, finishReason = null, usage) {
  return `data: ${JSON.stringify({
    ...base,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...(usage ? { usage } : {}),
  })}\n\n`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalJson(value[key])]),
  );
}

function sameJson(left, right) {
  try {
    return (
      JSON.stringify(canonicalJson(JSON.parse(left))) ===
      JSON.stringify(canonicalJson(JSON.parse(right)))
    );
  } catch {
    return false;
  }
}

function structuredJson(text) {
  try {
    const value = JSON.parse(text);
    return Boolean(value && typeof value === "object");
  } catch {
    return false;
  }
}

function chatEmitter(controller, adapter, model, schema) {
  const encoder = new TextEncoder();
  const base = {
    id: `modelpatrol-${adapter}-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
  };
  let roleSent = false;
  let streamed = "";
  return {
    get text() {
      return streamed;
    },
    emit(delta) {
      if (!delta) return;
      streamed += delta;
      controller.enqueue(
        encoder.encode(
          chatChunk(base, {
            ...(!roleSent ? { role: "assistant" } : {}),
            content: delta,
          }),
        ),
      );
      roleSent = true;
    },
    complete(terminal, usage) {
      if (typeof terminal !== "string" || !terminal)
        throw new Error(`${adapter} stream has no final response`);
      if (schema && !structuredJson(terminal))
        throw new Error(`${adapter} stream returned invalid structured JSON`);
      if (!streamed) this.emit(terminal);
      else if (terminal.startsWith(streamed)) this.emit(terminal.slice(streamed.length));
      else if (
        streamed.trim() !== terminal.trim() &&
        !sameJson(streamed, terminal)
      )
        throw new Error(`${adapter} streamed response differs from final result`);
      controller.enqueue(encoder.encode(chatChunk(base, {}, "stop", chatUsage(usage))));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    },
  };
}

function textGate(schema, emit) {
  const items = new Map();
  return (key, delta) => {
    if (typeof delta !== "string" || !delta) return;
    if (!schema) {
      emit(delta);
      return;
    }
    const item = items.get(key) ?? { mode: "pending", text: "" };
    item.text += delta;
    if (item.mode === "pending" && item.text.trimStart()) {
      item.mode = item.text.trimStart().startsWith("{") ? "stream" : "ignore";
      if (item.mode === "stream") emit(item.text);
    } else if (item.mode === "stream") emit(delta);
    items.set(key, item);
  };
}

function ndjsonChatStream({ adapter, command, args, model, options, onEvent, onClose }) {
  let child;
  let finished = false;
  return new ReadableStream({
    start(controller) {
      const timeoutMs = options.timeoutMs ?? 120_000;
      child = (options.spawnImpl ?? spawn)(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const decoder = new StringDecoder("utf8");
      let lines = "";
      let stderr = "";
      const emitter = chatEmitter(controller, adapter, model, options.schema);
      const gate = textGate(options.schema, (delta) => emitter.emit(delta));
      const cleanup = async () => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", aborted);
        await options.cleanup?.();
      };
      const finish = (error) => {
        if (finished) return;
        finished = true;
        child?.kill();
        void cleanup();
        if (error) controller.error(error);
        else controller.close();
      };
      const complete = (terminal, usage) => {
        emitter.complete(terminal, usage);
        finish();
      };
      const eventLine = (line) => {
        if (!line.trim()) return;
        if (Buffer.byteLength(line) > 1_048_576)
          throw new Error(`${adapter} stream event exceeds byte limit`);
        const event = JSON.parse(line);
        onEvent(event, { complete, emit: emitter.emit.bind(emitter), gate, emitter });
      };
      child.stdout.on("data", (chunk) => {
        if (finished) return;
        try {
          lines += decoder.write(chunk);
          let newline = lines.indexOf("\n");
          while (newline >= 0) {
            eventLine(lines.slice(0, newline).replace(/\r$/, ""));
            lines = lines.slice(newline + 1);
            newline = lines.indexOf("\n");
          }
        } catch (error) {
          finish(error);
        }
      });
      child.stderr.on("data", (chunk) => {
        stderr = `${stderr}${chunk}`.slice(-65_536);
      });
      child.once("error", finish);
      child.once("close", (code) => {
        if (finished) return;
        try {
          lines += decoder.end();
          if (lines) eventLine(lines.replace(/\r$/, ""));
          if (!finished && code === 0 && onClose)
            onClose({ complete, emit: emitter.emit.bind(emitter), gate, emitter });
          if (!finished)
            finish(
              new Error(
                code
                  ? stderr || `${command} exited ${code}`
                  : `${adapter} stream ended without a result event`,
              ),
            );
        } catch (error) {
          finish(error);
        }
      });
      const aborted = () => finish(new Error("Harness request aborted"));
      const timer = setTimeout(
        () => finish(new Error(`${adapter} timed out`)),
        timeoutMs,
      );
      timer.unref();
      options.signal?.addEventListener("abort", aborted, { once: true });
    },
    cancel() {
      if (!finished) {
        finished = true;
        child?.kill();
        void options.cleanup?.();
      }
    },
  });
}

/** Translate Antigravity's documented NDJSON stream into native Chat SSE. */
export function antigravityChatStream(input, model, options) {
  const timeoutMs = options.timeoutMs ?? 120_000;
  return ndjsonChatStream({
    adapter: "Antigravity",
    command: "agy",
    args: [
      "-p",
      input,
      "--output-format",
      "stream-json",
      "--mode",
      options.step === "build" ? "accept-edits" : "plan",
      "--dangerously-skip-permissions",
      "--new-project",
      "--add-dir",
      options.cwd,
      "--model",
      model,
      "--print-timeout",
      `${Math.max(1, Math.ceil(timeoutMs / 1000))}s`,
      ...jsonSchemaArg(options),
    ],
    model,
    options,
    onEvent(event, stream) {
      if (event.event === "step_update") {
        const update = event.step_update;
        if (update?.step_type === "agent_response")
          stream.gate(update.step_index ?? "unknown", update.text_delta);
        return;
      }
      if (event.event !== "result") return;
      const result = event.result;
      if (result?.status !== "SUCCESS")
        throw new Error("Antigravity streaming request failed");
      stream.complete(harnessCompletionText(result), result.usage);
    },
  });
}

/** Translate Claude Code stream-json records into native Chat SSE. */
export function claudeChatStream(input, model, options) {
  return ndjsonChatStream({
    adapter: "Claude",
    command: "claude",
    args: [
      "-p",
      input,
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--permission-mode",
      options.step === "build" ? "acceptEdits" : "plan",
      "--max-turns",
      "10",
      "--model",
      model,
      ...(options.schema
        ? ["--json-schema", JSON.stringify(options.schema)]
        : []),
    ],
    model,
    options,
    onEvent(record, stream) {
      const event = record.type === "stream_event" ? record.event : record;
      if (
        event?.type === "content_block_delta" &&
        event.delta?.type === "text_delta"
      ) {
        stream.gate(event.index ?? "assistant", event.delta.text);
        return;
      }
      if (record.type !== "result") return;
      if (record.is_error) throw new Error("Claude streaming request failed");
      stream.complete(harnessCompletionText(record), record.usage);
    },
  });
}

/** Translate Grok Build's Anthropic-compatible NDJSON into native Chat SSE. */
export function grokChatStream(input, model, options) {
  let usage;
  return ndjsonChatStream({
    adapter: "Grok",
    command: "grok",
    args: [
      "-p",
      input,
      "--output-format",
      "streaming-messages-json",
      "--include-partial-messages",
      "--permission-mode",
      options.step === "build" ? "acceptEdits" : "plan",
      "--max-turns",
      "10",
      "--model",
      model,
    ],
    model,
    options,
    onEvent(record, stream) {
      const event = record.type === "stream_event" ? record.event : record;
      if (event?.type === "message_start") usage = event.message?.usage ?? usage;
      if (
        event?.type === "content_block_delta" &&
        event.delta?.type === "text_delta"
      ) {
        stream.gate(event.index ?? "assistant", event.delta.text);
        return;
      }
      if (event?.type === "message_delta")
        usage = { ...usage, ...event.usage };
      if (record.type === "result") {
        if (record.is_error || record.type === "error")
          throw new Error("Grok streaming request failed");
        stream.complete(harnessCompletionText(record), record.usage ?? usage);
      } else if (event?.type === "message_stop") {
        stream.complete(stream.emitter.text, usage);
      } else if (event?.type === "error") {
        throw new Error("Grok streaming request failed");
      }
    },
  });
}

/** Collapse TypeBox anyOf/const unions to enum so CLI --json-schema accepts them. */
export function cliJsonSchema(schema) {
  if (Array.isArray(schema)) return schema.map(cliJsonSchema);
  if (!schema || typeof schema !== "object") return schema;
  const variants = schema.anyOf;
  if (
    Array.isArray(variants) &&
    variants.length > 0 &&
    variants.every(
      (item) =>
        item &&
        typeof item === "object" &&
        Object.hasOwn(item, "const") &&
        typeof item.const === "string",
    )
  )
    return { type: "string", enum: variants.map((item) => item.const) };
  const result = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "const" && typeof value === "string") {
      result.type = "string";
      result.enum = [value];
      continue;
    }
    if (key === "type" && result.enum && value === "string") continue;
    result[key] = cliJsonSchema(value);
  }
  return result;
}

function jsonSchemaArg(options) {
  if (options.schemaPath) return ["--json-schema", options.schemaPath];
  if (options.schema) return ["--json-schema", JSON.stringify(options.schema)];
  return [];
}

/** Prefer schema-constrained objects over CLI prose wrappers. */
export function harnessCompletionText(reply) {
  if (!reply || typeof reply !== "object") return undefined;
  if (reply.structured_output && typeof reply.structured_output === "object")
    return JSON.stringify(reply.structured_output);
  const text =
    typeof reply.response === "string"
      ? reply.response
      : typeof reply.text === "string"
        ? reply.text
        : typeof reply.result === "string"
          ? reply.result
          : undefined;
  if (!text?.trim()) return undefined;
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") return JSON.stringify(parsed);
  } catch {
    /* Harness prose is returned unchanged. */
  }
  return trimmed;
}

/** User text from Chat/Responses bodies, including OpenAI content parts. */
export function harnessPrompt(body, api, schema) {
  let prompt;
  if (api === "responses") {
    if (typeof body.input === "string") prompt = body.input;
    if (!prompt) {
      const parts = (body.input ?? []).flatMap((item) => item.content ?? item)
        .map((item) => (typeof item === "string" ? item : contentText([item])))
        .filter(Boolean);
      if (parts.length) prompt = parts.join("\n");
    }
  }
  if (!prompt) {
    const parts = (body.messages ?? [])
      .filter((item) => item.role === "user")
      .map((item) => contentText(item.content))
      .filter(Boolean);
    if (parts.length) prompt = parts.join("\n");
  }
  if (!prompt) throw new Error("Harness requests require user text");
  if (!schema) return prompt;
  return `${prompt}\n\nThe transport cannot return a native function call. Your final answer MUST be exactly one JSON object matching the following JSON Schema. Do not add markdown, prose, or fields outside the schema.\n${JSON.stringify(schema)}`;
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
    const child = spawn("codex", ["app-server"], {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: options.env,
    });
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
    const timer = setTimeout(
      () => finish(new Error("Codex turn timed out")),
      options.timeoutMs ?? 120_000,
    );
    timer.unref();
    options.signal?.addEventListener("abort", aborted, { once: true });
    (async () => {
      try {
        await call("initialize", { clientInfo: { name: "modelpatrol", version: "1.0" } });
        child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
        const thread = await call("thread/start", { model });
        const threadId = thread.thread?.id ?? thread.id;
        await call("turn/start", {
          threadId,
          input: [{ type: "text", text: input }],
          cwd: options.cwd,
          model,
          outputSchema: options.schema,
          approvalPolicy: "never",
          sandboxPolicy:
            options.step === "build"
              ? {
                  type: "workspaceWrite",
                  writableRoots: [options.cwd],
                  networkAccess: false,
                }
              : { type: "readOnly", networkAccess: false },
        });
      } catch (error) { finish(error); }
    })();
  });
}

/** Translate Codex app-server agent message deltas into native Chat SSE. */
export function codexChatStream(input, model, options) {
  let child;
  let finished = false;
  return new ReadableStream({
    start(controller) {
      child = (options.spawnImpl ?? spawn)("codex", ["app-server"], {
        cwd: options.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: options.env,
      });
      const emitter = chatEmitter(controller, "Codex", model, options.schema);
      const gate = textGate(options.schema, (delta) => emitter.emit(delta));
      const decoder = new StringDecoder("utf8");
      const pending = new Map();
      let next = 1;
      let lines = "";
      let stderr = "";
      let answer = "";
      let usage;
      const cleanup = async () => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", aborted);
        await options.cleanup?.();
      };
      const finish = (error) => {
        if (finished) return;
        finished = true;
        child?.kill();
        void cleanup();
        if (error) controller.error(error);
        else controller.close();
      };
      const call = (method, params) =>
        new Promise((resolve, reject) => {
          const id = next++;
          pending.set(id, { resolve, reject });
          child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
        });
      const messageLine = (line) => {
        if (!line.trim()) return;
        if (Buffer.byteLength(line) > 1_048_576)
          throw new Error("Codex stream event exceeds byte limit");
        const message = JSON.parse(line);
        if (message.id !== undefined) {
          const request = pending.get(message.id);
          if (!request) return;
          pending.delete(message.id);
          if (message.error)
            request.reject(new Error(message.error.message || "Codex RPC failed"));
          else request.resolve(message.result);
          return;
        }
        if (message.method === "item/agentMessage/delta") {
          gate(message.params?.itemId ?? "assistant", message.params?.delta);
          return;
        }
        if (
          message.method === "item/completed" &&
          message.params?.item?.type === "agentMessage" &&
          typeof message.params.item.text === "string"
        ) {
          answer = message.params.item.text;
          return;
        }
        if (message.method === "thread/tokenUsage/updated") {
          usage = message.params?.tokenUsage?.last ?? usage;
          return;
        }
        if (message.method !== "turn/completed") return;
        if (message.params?.turn?.status !== "completed")
          throw new Error("Codex streaming request failed");
        emitter.complete(answer, usage);
        finish();
      };
      child.stdout.on("data", (chunk) => {
        if (finished) return;
        try {
          lines += decoder.write(chunk);
          let newline = lines.indexOf("\n");
          while (newline >= 0) {
            messageLine(lines.slice(0, newline).replace(/\r$/, ""));
            lines = lines.slice(newline + 1);
            newline = lines.indexOf("\n");
          }
        } catch (error) {
          finish(error);
        }
      });
      child.stderr.on("data", (chunk) => {
        stderr = `${stderr}${chunk}`.slice(-65_536);
      });
      child.stdin.on("error", (error) => finish(error));
      child.once("error", finish);
      child.once("close", (code) => {
        if (finished) return;
        finish(new Error(code ? stderr || `codex exited ${code}` : "Codex stream ended without turn/completed"));
      });
      const aborted = () => finish(new Error("Harness request aborted"));
      const timer = setTimeout(
        () => finish(new Error("Codex timed out")),
        options.timeoutMs ?? 120_000,
      );
      timer.unref();
      options.signal?.addEventListener("abort", aborted, { once: true });
      void (async () => {
        try {
          await call("initialize", {
            clientInfo: { name: "modelpatrol", version: "1.0" },
          });
          child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
          const thread = await call("thread/start", { model });
          const threadId = thread.thread?.id ?? thread.id;
          await call("turn/start", {
            threadId,
            input: [{ type: "text", text: input }],
            cwd: options.cwd,
            model,
            outputSchema: options.schema,
            approvalPolicy: "never",
            sandboxPolicy:
              options.step === "build"
                ? {
                    type: "workspaceWrite",
                    writableRoots: [options.cwd],
                    networkAccess: false,
                  }
                : { type: "readOnly", networkAccess: false },
          });
        } catch (error) {
          finish(error);
        }
      })();
    },
    cancel() {
      if (!finished) {
        finished = true;
        child?.kill();
        void options.cleanup?.();
      }
    },
  });
}

/** Translate OpenCode's headless NDJSON records without opening another listener. */
export function opencodeChatStream(input, model, options) {
  const qualified = model.includes("/") ? model : `opencode/${model}`;
  let usage;
  return ndjsonChatStream({
    adapter: "OpenCode",
    command: "opencode",
    args: [
      "run",
      input,
      "--model",
      qualified,
      "--agent",
      options.step === "build" ? "build" : "plan",
      "--dir",
      options.cwd,
      "--format",
      "json",
      "--pure",
      ...(options.step === "build" ? ["--auto"] : []),
    ],
    model,
    options,
    onEvent(event, stream) {
      if (event.type === "text") {
        const part = event.part;
        if (part?.type === "text" && part.synthetic !== true)
          stream.gate(part.id ?? part.messageID ?? "assistant", part.text);
        return;
      }
      if (event.type === "error")
        throw new Error("OpenCode streaming request failed");
      if (event.type === "step_finish") {
        usage = event.part?.tokens ?? usage;
        if (event.part?.reason === "stop")
          stream.complete(stream.emitter.text, usage);
      }
    },
    onClose(stream) {
      stream.complete(stream.emitter.text, usage);
    },
  });
}
const adapters = {
  codex: {
    capabilities: () => ({ apis: ["chat", "responses"], streaming: true }),
    invoke: (input, model, options) => codexTurn(input, model, options),
    stream: (input, model, options) => codexChatStream(input, model, options),
  },
  claude: {
    capabilities: () => ({ apis: ["chat", "messages"], streaming: true }),
    invoke: async (input, model, options) => {
      const args = [
        "-p",
        input,
        "--output-format",
        "json",
        "--permission-mode",
        options.step === "build" ? "acceptEdits" : "plan",
        "--max-turns",
        "10",
        "--model",
        model,
        ...(options.schema
          ? ["--json-schema", JSON.stringify(options.schema)]
          : []),
      ];
      const reply = JSON.parse(await run("claude", args, options));
      if (reply.is_error) throw new Error(reply.result || "Claude request failed");
      const text = harnessCompletionText(reply);
      if (!text) throw new Error("Claude request failed");
      return { text, usage: reply.usage };
    },
    stream: (input, model, options) => claudeChatStream(input, model, options),
  },
  opencode: {
    capabilities: () => ({ apis: ["chat", "responses"], streaming: true }),
    invoke: (input, model, options) =>
      run(
        "opencode",
        [
          "run",
          input,
          "--model",
          model.includes("/") ? model : `opencode/${model}`,
          "--agent",
          options.step === "build" ? "build" : "plan",
          "--dir",
          options.cwd,
        ],
        options,
      ),
    stream: (input, model, options) => opencodeChatStream(input, model, options),
  },
  grok: {
    capabilities: () => ({ apis: ["chat"], streaming: true }),
    invoke: async (input, model, options) => {
      const args = ["-p", input, "--output-format", "json", "--permission-mode", options.step === "build" ? "acceptEdits" : "plan", "--max-turns", "10", "--model", model, ...jsonSchemaArg(options)];
      const reply = JSON.parse(await run("grok", args, options));
      if (reply.type === "error") throw new Error(reply.message || "Grok request failed");
      const text = harnessCompletionText(reply);
      if (!text) throw new Error(reply.message || "Grok request failed");
      return text;
    },
    stream: (input, model, options) => grokChatStream(input, model, options),
  },
  antigravity: {
    capabilities: () => ({ apis: ["chat"], streaming: true }),
    invoke: async (input, model, options) => {
      const args = ["-p", input, "--output-format", "json", "--mode", options.step === "build" ? "accept-edits" : "plan", "--dangerously-skip-permissions", "--new-project", "--add-dir", options.cwd, "--model", model, "--print-timeout", `${Math.max(1, Math.ceil((options.timeoutMs ?? 120000) / 1000))}s`, ...jsonSchemaArg(options)];
      const reply = JSON.parse(await run("agy", args, options));
      if (reply.status !== "SUCCESS") throw new Error(reply.message || "Antigravity request failed");
      const text = harnessCompletionText(reply);
      if (!text) throw new Error(reply.message || "Antigravity request failed");
      return { text, usage: reply.usage };
    },
    stream: (input, model, options) => antigravityChatStream(input, model, options),
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

/** Prefer an explicit stage worktree; never fall back to a configured operator project when isolating. */
export function harnessCwd({ requested, configured, isolate }) {
  const path = requested || (!isolate && configured) || undefined;
  if (path && !isAbsolute(path)) throw new Error("Harness workspace must be absolute");
  return path;
}

export async function invokeHarness(provider, api, body, { env = process.env, signal, workspace, step, timeoutMs } = {}) {
  const adapter = getHarness(provider.transport.adapter);
  if (!adapter.capabilities().apis.includes(api)) throw new Error("Harness does not support this API");
  const configured = provider.transport.workspaceEnv && env[provider.transport.workspaceEnv];
  const schema = cliJsonSchema(structuredOutputSchema(chatFunctionTools(body), step));
  const cwd = harnessCwd({
    requested: workspace,
    configured,
    isolate: Boolean(schema) && !workspace,
  });
  const temporary = cwd ? null : await mkdtemp(join(tmpdir(), "modelpatrol-harness-"));
  const workdir = cwd ?? temporary;
  const schemaDir = schema ? await mkdtemp(join(tmpdir(), "modelpatrol-schema-")) : null;
  const cleanup = async () => {
    if (temporary) await rm(temporary, { recursive: true, force: true });
    if (schemaDir) await rm(schemaDir, { recursive: true, force: true });
  };
  try {
    const schemaPath = schemaDir ? join(schemaDir, "schema.json") : undefined;
    if (schemaPath) await writeFile(schemaPath, JSON.stringify(schema));
    const options = {
      cwd: workdir,
      env,
      signal,
      schema,
      schemaPath,
      step,
      timeoutMs,
    };
    if (body.stream && adapter.stream) {
      const stream = adapter.stream(harnessPrompt(body, api, schema), body.model, {
        ...options,
        cleanup,
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }
    const value = await adapter.invoke(harnessPrompt(body, api, schema), body.model, options);
    const result = typeof value === "string" ? { text: value } : value;
    if (api === "chat") return { id: `modelpatrol-${provider.transport.adapter}-${Date.now()}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: body.model, choices: [{ index: 0, message: { role: "assistant", content: result.text }, finish_reason: "stop" }], ...(result.usage ? { usage: { prompt_tokens: result.usage.input_tokens, completion_tokens: result.usage.output_tokens, prompt_tokens_details: { cached_tokens: result.usage.cache_read_tokens ?? 0 } } } : {}) };
    if (api === "messages") return { id: `modelpatrol-${provider.transport.adapter}-${Date.now()}`, type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: result.text }], stop_reason: "end_turn" };
    return { id: `modelpatrol-${provider.transport.adapter}-${Date.now()}`, object: "response", status: "completed", model: body.model, output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: result.text }] }], output_text: result.text };
  } finally {
    if (!(body.stream && adapter.stream)) await cleanup();
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
