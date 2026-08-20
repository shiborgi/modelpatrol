import type { Protocol } from "../core/constants.js";

export type JsonRecord = Record<string, unknown>;

export function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function inboundProtocol(pathname: string): Protocol | "responses" | null {
  if (pathname === "/v1/messages" || pathname === "/v1/messages/count_tokens") {
    return "anthropic";
  }
  if (pathname === "/v1/chat/completions" || pathname === "/v1/completions") {
    return "openai";
  }
  if (pathname === "/v1/responses") {
    return "responses";
  }
  return null;
}

export function translateBody(
  body: JsonRecord,
  from: Protocol | "responses",
  to: Protocol,
  model: string,
): { path: string; body: JsonRecord } {
  if (from === "responses" && to === "openai") {
    return { path: "/responses", body: { ...body, model } };
  }
  if (from === "responses" && to === "anthropic") {
    return {
      path: "/messages",
      body: openaiChatToAnthropic(responsesToChat(body), model),
    };
  }
  if (from === "openai" && to === "openai") {
    return { path: "/chat/completions", body: { ...body, model } };
  }
  if (from === "anthropic" && to === "anthropic") {
    return { path: "/messages", body: { ...body, model } };
  }
  if (from === "openai" && to === "anthropic") {
    return { path: "/messages", body: openaiChatToAnthropic(body, model) };
  }
  return { path: "/chat/completions", body: anthropicToOpenaiChat(body, model) };
}

export function rewriteResponseModel(payload: unknown, inboundModel: string): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }
  return { ...(payload as JsonRecord), model: inboundModel };
}

export function extractUsage(payload: unknown): {
  promptTokens: number;
  completionTokens: number;
} {
  const record = asRecord(payload);
  const usage = asRecord(record.usage);
  const prompt =
    num(usage.prompt_tokens) ??
    num(usage.input_tokens) ??
    num(asRecord(record.usage).prompt_tokens) ??
    0;
  const completion = num(usage.completion_tokens) ?? num(usage.output_tokens) ?? 0;
  return { promptTokens: prompt, completionTokens: completion };
}

export function extractSseUsage(chunks: string): {
  promptTokens: number;
  completionTokens: number;
} {
  let promptTokens = 0;
  let completionTokens = 0;
  for (const line of chunks.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      continue;
    }
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") {
      continue;
    }
    try {
      const parsed = JSON.parse(data) as unknown;
      const usage = extractUsage(parsed);
      const message = asRecord(asRecord(parsed).message);
      const messageUsage = extractUsage({ usage: message.usage });
      if (usage.promptTokens) {
        promptTokens = usage.promptTokens;
      }
      if (usage.completionTokens) {
        completionTokens = usage.completionTokens;
      }
      if (messageUsage.promptTokens) {
        promptTokens = messageUsage.promptTokens;
      }
      if (messageUsage.completionTokens) {
        completionTokens = messageUsage.completionTokens;
      }
    } catch {}
  }
  return { promptTokens, completionTokens };
}

function responsesToChat(body: JsonRecord): JsonRecord {
  const input = body.input;
  const messages: unknown[] = [];
  if (typeof input === "string") {
    messages.push({ role: "user", content: input });
  } else if (Array.isArray(input)) {
    for (const item of input) {
      if (typeof item === "string") {
        messages.push({ role: "user", content: item });
      } else {
        const rec = asRecord(item);
        messages.push({
          role: rec.role ?? "user",
          content: rec.content ?? rec.text ?? "",
        });
      }
    }
  }
  return {
    model: body.model,
    messages,
    stream: body.stream === true,
    temperature: body.temperature,
    max_tokens: body.max_output_tokens ?? body.max_tokens,
  };
}

function openaiChatToAnthropic(body: JsonRecord, model: string): JsonRecord {
  const messages = asArray(body.messages);
  const systemParts: string[] = [];
  const converted: unknown[] = [];
  for (const item of messages) {
    const rec = asRecord(item);
    if (rec.role === "system") {
      systemParts.push(contentToText(rec.content));
      continue;
    }
    converted.push({
      role: rec.role === "assistant" ? "assistant" : "user",
      content: rec.content ?? "",
    });
  }
  const out: JsonRecord = {
    model,
    messages: converted,
    max_tokens: num(body.max_tokens) ?? 4096,
    stream: body.stream === true,
  };
  if (systemParts.length > 0) {
    out.system = systemParts.join("\n\n");
  }
  if (body.temperature !== undefined) {
    out.temperature = body.temperature;
  }
  if (body.tools !== undefined) {
    out.tools = body.tools;
  }
  return out;
}

function anthropicToOpenaiChat(body: JsonRecord, model: string): JsonRecord {
  const messages: unknown[] = [];
  if (typeof body.system === "string" && body.system) {
    messages.push({ role: "system", content: body.system });
  }
  for (const item of asArray(body.messages)) {
    const rec = asRecord(item);
    messages.push({
      role: rec.role === "assistant" ? "assistant" : "user",
      content: rec.content ?? "",
    });
  }
  const out: JsonRecord = {
    model,
    messages,
    stream: body.stream === true,
  };
  if (body.temperature !== undefined) {
    out.temperature = body.temperature;
  }
  if (body.max_tokens !== undefined) {
    out.max_tokens = body.max_tokens;
  }
  if (body.tools !== undefined) {
    out.tools = body.tools;
  }
  return out;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        const rec = asRecord(part);
        return typeof rec.text === "string" ? rec.text : "";
      })
      .join("");
  }
  return "";
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
