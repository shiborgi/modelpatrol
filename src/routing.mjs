import { check } from "./config.mjs";

export const metadataFields = [
  "step",
  "agent",
  "profile",
  "harness",
  "project",
  "run-id",
  "session-id",
  "trace-id",
  "parent-id",
];
export function readMetadata(headers) {
  const metadata = {};
  for (const key of metadataFields) {
    const value = headers[`x-patrol-${key}`];
    if (value !== undefined) {
      check(
        typeof value === "string" && /^[a-zA-Z0-9_.:/, -]{1,256}$/.test(value),
        `Invalid x-patrol-${key}`,
      );
      metadata[key] = value;
    }
  }
  return metadata;
}
export function route(config, body, api, metadata, available = () => true) {
  check(typeof body.model === "string", "model is required");
  const required = [];
  if (body.tools?.length) required.push("tools");
  if (body.response_format || body.text?.format) required.push("json");
  const serialized = JSON.stringify(body);
  if (/"(?:image_url|input_image|image)"/.test(serialized))
    required.push("vision");
  if (body.reasoning || body.reasoning_effort || body.thinking)
    required.push("reasoning");
  // UTF-8 bytes are a deliberately conservative token upper estimate, not billed usage.
  const inputEstimate = Buffer.byteLength(serialized);
  const requestedOutput =
    body.max_completion_tokens ?? body.max_output_tokens ?? body.max_tokens;
  if (requestedOutput !== undefined)
    check(
      Number.isSafeInteger(requestedOutput) && requestedOutput > 0,
      "Invalid output token limit",
    );
  const eligible = config.models.filter(
    (m) =>
      m.apis.includes(api) &&
      available(m) &&
      required.every((cap) => m.capabilities.includes(cap)) &&
      (requestedOutput ?? m.maxOutputTokens) <= m.maxOutputTokens &&
      inputEstimate + (requestedOutput ?? m.maxOutputTokens) <= m.contextWindow,
  );
  if (body.model !== "auto") {
    const model = eligible.find((m) => m.id === body.model);
    check(model, "Explicit model unavailable or incompatible with request");
    return { models: [model], reason: "explicit", inputEstimate };
  }
  const rule = config.routing.rules.find((r) =>
    Object.entries(r.match).every(([key, value]) =>
      key === "profile"
        ? metadata.profile?.split(",").includes(value)
        : metadata[key] === value,
    ),
  );
  const priority =
    rule?.models ??
    (config.routing.defaultModel ? [config.routing.defaultModel] : []);
  const score = (m) =>
    m.quality -
    (m.pricing
      ? Math.min((m.pricing.input + m.pricing.output) / 1000, 0.2)
      : 0.2);
  const ranked = [...eligible].sort(
    (a, b) => score(b) - score(a) || a.id.localeCompare(b.id),
  );
  const ids = [
    ...new Set([
      ...priority,
      ...config.routing.fallbacks,
      ...ranked.map((m) => m.id),
    ]),
  ];
  const models = ids
    .map((id) => eligible.find((m) => m.id === id))
    .filter(Boolean);
  check(models.length, "No compatible model is available");
  return {
    models,
    reason: rule
      ? `rule:${rule.id}`
      : priority.length
        ? "default"
        : "quality-cost",
    inputEstimate,
  };
}
