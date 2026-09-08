export function extractUsage(payload, api, previous = null) {
  const raw =
    payload.usage ?? payload.message?.usage ?? payload.response?.usage;
  if (!raw) return previous;
  const input = raw.prompt_tokens ?? raw.input_tokens ?? previous?.inputTokens;
  const output =
    raw.completion_tokens ?? raw.output_tokens ?? previous?.outputTokens;
  const read =
    raw.cache_read_input_tokens ??
    raw.prompt_tokens_details?.cached_tokens ??
    raw.input_tokens_details?.cached_tokens ??
    previous?.cacheReadTokens ??
    0;
  const write =
    raw.cache_creation_input_tokens ?? previous?.cacheWriteTokens ?? 0;
  if (
    ![input, output, read, write].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    )
  )
    return previous;
  return {
    inputTokens:
      api === "messages" && raw.input_tokens !== undefined
        ? input + read + write
        : input,
    outputTokens: output,
    cacheReadTokens: read,
    cacheWriteTokens: write,
    inputIncludesCache: true,
  };
}
export function costFor(usage, model, plan) {
  if (!usage || !model.pricing || plan.kind === "subscription") return null;
  const p = model.pricing;
  if (
    (usage.cacheReadTokens && p.cacheRead === undefined) ||
    (usage.cacheWriteTokens && p.cacheWrite === undefined)
  )
    return null;
  const input = usage.inputIncludesCache
    ? Math.max(
        0,
        usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens,
      )
    : usage.inputTokens;
  return (
    (input * p.input +
      usage.outputTokens * p.output +
      usage.cacheReadTokens * (p.cacheRead ?? 0) +
      usage.cacheWriteTokens * (p.cacheWrite ?? 0)) /
    1e6
  );
}

export class StreamMeter {
  constructor(api) {
    this.api = api;
    this.buffer = "";
    this.decoder = new TextDecoder();
    this.usage = null;
    this.complete = false;
  }
  push(chunk) {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    if (this.buffer.length > 1048576)
      throw new Error("SSE event exceeds limit");
    let at;
    while ((at = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, at).trimEnd();
      this.buffer = this.buffer.slice(at + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") {
        this.complete = true;
        continue;
      }
      try {
        const payload = JSON.parse(data);
        this.usage = extractUsage(payload, this.api, this.usage);
        if (["response.completed", "message_stop"].includes(payload.type))
          this.complete = true;
        if (
          payload.type === "error" ||
          payload.type === "response.failed" ||
          payload.error
        )
          this.failed = true;
      } catch {
        /* Other SSE data is not usage evidence. */
      }
    }
  }
}
