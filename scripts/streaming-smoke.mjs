#!/usr/bin/env node

const baseUrl = (process.env.MODELPATROL_BASE_URL ?? "http://127.0.0.1:4318").replace(
  /\/$/,
  "",
);
const apiKey = process.env.MODELPATROL_API_KEY;
const timeoutMs = Number(process.env.MODELPATROL_SMOKE_TIMEOUT_MS ?? 300_000);
const models = process.argv.slice(2);
if (!models.length)
  models.push(
    "claude/coder",
    "codex/coder",
    "opencode/coder",
    "grok/coder",
    "ollama/coder",
  );
if (!apiKey) throw new Error("MODELPATROL_API_KEY is required");
if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
  throw new Error("MODELPATROL_SMOKE_TIMEOUT_MS must be a positive integer");

async function smoke(model) {
  const started = Date.now();
  const completedPartStream = model.split("/", 1)[0] === "opencode";
  const minimumDeltas = completedPartStream ? 1 : 2;
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "x-patrol-step": "plan",
      "x-patrol-agent": "smoke",
      "x-patrol-harness": "streaming-smoke",
      "x-patrol-project": "modelpatrol",
    },
    body: JSON.stringify({
      model,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        {
          role: "user",
          content:
            "Write exactly twelve numbered lines. Each line must contain five different lowercase words. Do not use tools or add an introduction.",
        },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok || !response.body)
    throw new Error(`${model}: gateway returned ${response.status}`);
  if (!response.headers.get("content-type")?.includes("text/event-stream"))
    throw new Error(`${model}: gateway did not return SSE`);

  const decoder = new TextDecoder();
  let buffer = "";
  let data = [];
  let deltas = 0;
  let ttftMs;
  let done = false;
  let finished = false;
  const line = (value) => {
    if (value === "") {
      if (!data.length) return;
      const payload = data.join("\n");
      data = [];
      if (payload === "[DONE]") {
        done = true;
        return;
      }
      const event = JSON.parse(payload);
      const choice = event.choices?.[0];
      if (typeof choice?.delta?.content === "string" && choice.delta.content) {
        ttftMs ??= Date.now() - started;
        deltas += 1;
      }
      if (choice?.finish_reason) finished = true;
      return;
    }
    if (value.startsWith("data:")) data.push(value.slice(5).trimStart());
  };
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      line(buffer.slice(0, newline).replace(/\r$/, ""));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  buffer += decoder.decode();
  if (buffer) line(buffer.replace(/\r$/, ""));
  line("");
  if (deltas < minimumDeltas)
    throw new Error(
      `${model}: expected at least ${minimumDeltas} content delta(s), received ${deltas}`,
    );
  if (!finished || !done) throw new Error(`${model}: stream ended without finish/[DONE]`);
  return {
    model,
    status: "ok",
    ttftMs,
    durationMs: Date.now() - started,
    deltas,
    granularity: completedPartStream ? "completed-text-part" : "partial-text",
  };
}

let failed = false;
for (const model of models) {
  try {
    process.stdout.write(`${JSON.stringify(await smoke(model))}\n`);
  } catch (error) {
    failed = true;
    process.stderr.write(
      `${JSON.stringify({
        model,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      })}\n`,
    );
  }
}
if (failed) process.exitCode = 1;
