import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { getHarness, hasHarness } from "./harnesses.mjs";

export const endpoints = {
  chat: "/v1/chat/completions",
  responses: "/v1/responses",
  messages: "/v1/messages",
};
export const presets = {
  anthropic: {
    baseUrl: "https://api.anthropic.com",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    auth: "anthropic",
  },
  codex: {
    baseUrl: "https://api.openai.com",
    apiKeyEnv: "OPENAI_API_KEY",
    auth: "bearer",
  },
  "ollama-cloud": {
    baseUrl: "https://ollama.com",
    apiKeyEnv: "OLLAMA_API_KEY",
    auth: "bearer",
  },
  grok: {
    baseUrl: "https://api.x.ai",
    apiKeyEnv: "XAI_API_KEY",
    auth: "bearer",
  },
  opencode: {
    baseUrl: "https://opencode.ai/zen",
    apiKeyEnv: "OPENCODE_API_KEY",
    auth: "bearer",
  },
};
export class GatewayError extends Error {
  constructor(message) {
    super(message);
    this.name = "GatewayError";
  }
}
export function check(value, message) {
  if (!value) throw new GatewayError(message);
}
function object(value, keys, label) {
  check(
    value && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`,
  );
  check(
    Object.keys(value).every((key) => keys.includes(key)),
    `Unknown ${label} field`,
  );
}
const id = (value) =>
  typeof value === "string" && /^[a-zA-Z0-9_.:/-]{1,160}$/.test(value);
const envName = (value) =>
  typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
const amount = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
export function validateConfig(input) {
  const c = structuredClone(input);
  object(
    c,
    [
      "protocolVersion",
      "host",
      "port",
      "dataDir",
      "gatewayKeyEnv",
      "providers",
      "models",
      "routing",
      "limits",
      "cache",
      "budgetUsd",
    ],
    "config",
  );
  check(c.protocolVersion === "1.0", "Expected protocolVersion 1.0");
  c.host ??= "127.0.0.1";
  c.port ??= 4318;
  c.dataDir ??= ".modelpatrol";
  c.gatewayKeyEnv ??= "MODELPATROL_API_KEY";
  check(
    typeof c.host === "string" &&
      Number.isInteger(c.port) &&
      c.port >= 0 &&
      c.port <= 65535,
    "Invalid listen address",
  );
  check(
    typeof c.dataDir === "string" && c.dataDir.length > 0,
    "Invalid dataDir",
  );
  check(
    envName(c.gatewayKeyEnv),
    "Invalid key environment variable",
  );
  object(c.providers, Object.keys(c.providers ?? {}), "providers");
  for (const [name, p] of Object.entries(c.providers)) {
    check(id(name), "Invalid provider ID");
    object(p, ["preset", "baseUrl", "apiKeyEnv", "auth", "plan", "transport", "usageAdapter"], "provider");
    if (p.preset)
      check(Object.hasOwn(presets, p.preset), "Unknown provider preset");
    c.providers[name] = { ...presets[p.preset], ...p };
    const provider = c.providers[name];
    provider.transport ??= { kind: "http" };
    object(provider.transport, ["kind", "adapter", "workspaceEnv"], "transport");
    check(["http", "harness"].includes(provider.transport.kind), "Invalid provider transport");
    if (provider.transport.kind === "http") {
      check(provider.transport.adapter === undefined && provider.transport.workspaceEnv === undefined, "HTTP transport cannot configure a harness adapter");
      const url = new URL(provider.baseUrl);
      check(
        (url.protocol === "https:" ||
          (url.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) &&
          !url.username && !url.password && !url.search && !url.hash,
        "Provider URL requires HTTPS or loopback HTTP, without credentials/query",
      );
      provider.baseUrl = provider.baseUrl.replace(/\/$/, "");
    } else {
      check(hasHarness(provider.transport.adapter), "Unknown harness adapter");
      if (provider.transport.workspaceEnv !== undefined)
        check(envName(provider.transport.workspaceEnv), "Invalid harness workspace environment variable");
      check(provider.baseUrl === undefined && provider.apiKeyEnv === undefined && provider.auth === "none", "Harness transport cannot configure an upstream URL or credential");
    }
    if (provider.usageAdapter !== undefined)
      check(["ollama"].includes(provider.usageAdapter), "Unknown usage adapter");
    check(
      ["bearer", "anthropic", "none"].includes(provider.auth) &&
        (provider.auth === "none"
          ? provider.apiKeyEnv === undefined
          : envName(provider.apiKeyEnv)),
      "Invalid provider authentication",
    );
    provider.plan ??= { kind: "metered" };
    object(provider.plan, ["kind", "name", "monthlyUsd"], "plan");
    check(
      ["metered", "subscription"].includes(provider.plan.kind),
      "Invalid plan kind",
    );
    if (provider.plan.monthlyUsd !== undefined)
      check(amount(provider.plan.monthlyUsd), "Invalid subscription price");
  }
  check(
    Array.isArray(c.models) && c.models.length > 0 && c.models.length <= 500,
    "Configure 1–500 models",
  );
  const seen = new Set();
  for (const m of c.models) {
    object(
      m,
      [
        "id",
        "provider",
        "model",
        "apis",
        "capabilities",
        "contextWindow",
        "maxOutputTokens",
        "quality",
        "pricing",
      ],
      "model",
    );
    check(
      id(m.id) && m.id !== "auto" && !seen.has(m.id),
      "Invalid or duplicate model ID",
    );
    seen.add(m.id);
    check(
      Object.hasOwn(c.providers, m.provider) && id(m.model),
      "Invalid model provider or upstream ID",
    );
    check(
      Array.isArray(m.apis) &&
        m.apis.length &&
        m.apis.every((api) => Object.hasOwn(endpoints, api)),
      "Invalid model APIs",
    );
    const provider = c.providers[m.provider];
    if (provider.transport.kind === "harness") {
      const supported = getHarness(provider.transport.adapter).capabilities().apis;
      check(
        m.apis.every((api) => supported.includes(api)),
        "Model API is not supported by its harness adapter",
      );
    }
    m.capabilities ??= [];
    check(
      Array.isArray(m.capabilities) &&
        m.capabilities.every((x) =>
          ["tools", "vision", "reasoning", "json"].includes(x),
        ),
      "Invalid capabilities",
    );
    for (const key of ["contextWindow", "maxOutputTokens"])
      check(Number.isSafeInteger(m[key]) && m[key] > 0, `Invalid ${key}`);
    m.quality ??= 0.5;
    check(amount(m.quality) && m.quality <= 1, "Quality must be 0–1");
    if (m.pricing) {
      object(
        m.pricing,
        ["input", "output", "cacheRead", "cacheWrite"],
        "pricing",
      );
      check(
        amount(m.pricing.input) && amount(m.pricing.output),
        "Pricing requires input/output USD per million tokens",
      );
      for (const rate of Object.values(m.pricing))
        check(amount(rate), "Invalid token price");
    }
  }
  c.routing ??= {};
  object(c.routing, ["defaultModel", "rules", "fallbacks"], "routing");
  if (c.routing.defaultModel)
    check(seen.has(c.routing.defaultModel), "Unknown default model");
  c.routing.rules ??= [];
  check(
    Array.isArray(c.routing.rules) && c.routing.rules.length <= 100,
    "Invalid routing rules",
  );
  for (const rule of c.routing.rules) {
    object(rule, ["id", "match", "models"], "rule");
    check(id(rule.id), "Invalid rule ID");
    object(
      rule.match,
      ["step", "agent", "profile", "harness", "project"],
      "match",
    );
    check(Object.values(rule.match).every(id), "Invalid match value");
    check(
      Array.isArray(rule.models) &&
        rule.models.length > 0 &&
        rule.models.every((x) => seen.has(x)),
      "Unknown rule model",
    );
  }
  c.routing.fallbacks ??= [];
  check(
    Array.isArray(c.routing.fallbacks) &&
      c.routing.fallbacks.every((x) => seen.has(x)),
    "Invalid fallback models",
  );
  c.limits ??= {};
  object(
    c.limits,
    [
      "timeoutMs",
      "maxBodyBytes",
      "maxResponseBytes",
      "requestsPerMinute",
      "maxConcurrent",
    ],
    "limits",
  );
  c.limits = {
    timeoutMs: 120000,
    maxBodyBytes: 4 * 1024 * 1024,
    maxResponseBytes: 16 * 1024 * 1024,
    requestsPerMinute: 120,
    maxConcurrent: 16,
    ...c.limits,
  };
  for (const value of Object.values(c.limits))
    check(
      Number.isSafeInteger(value) && value > 0 && value <= 64 * 1024 * 1024,
      "Invalid limit",
    );
  c.cache ??= {};
  object(c.cache, ["ttlMs", "maxEntries"], "cache");
  c.cache = { ttlMs: 0, maxEntries: 100, ...c.cache };
  check(
    Number.isSafeInteger(c.cache.ttlMs) &&
      c.cache.ttlMs >= 0 &&
      Number.isSafeInteger(c.cache.maxEntries) &&
      c.cache.maxEntries > 0 &&
      c.cache.maxEntries <= 10000,
    "Invalid cache",
  );
  if (c.budgetUsd !== undefined)
    check(amount(c.budgetUsd), "Invalid monthly budget");
  return c;
}
export async function loadConfig(path) {
  const raw = await readFile(path, "utf8");
  check(Buffer.byteLength(raw) <= 1048576, "Configuration exceeds 1 MiB");
  const config = validateConfig(JSON.parse(raw));
  config.dataDir = resolve(dirname(resolve(path)), config.dataDir);
  return config;
}
