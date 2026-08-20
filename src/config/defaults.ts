import { CODE_INTENTS, DEFAULT_HOST, DEFAULT_PORT } from "../core/constants.js";
import type { Config, PlanDefinition } from "../core/model.js";

export const DEFAULT_PLANS: Record<string, PlanDefinition> = {
  codex: {
    id: "codex",
    label: "OpenAI Codex",
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    authEnv: "CODEX_API_KEY",
    authEnvFallbacks: ["OPENAI_API_KEY"],
    defaultModel: "gpt-5.3-codex",
    extraHeaders: {},
    oauthPlan: "codex",
  },
  zai: {
    id: "zai",
    label: "z.ai Coding Plan",
    protocol: "openai",
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
    authEnv: "ZAI_API_KEY",
    authEnvFallbacks: [],
    defaultModel: "glm-4.6",
    extraHeaders: {},
  },
  alibaba: {
    id: "alibaba",
    label: "Alibaba Token Plan",
    protocol: "openai",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    authEnv: "DASHSCOPE_API_KEY",
    authEnvFallbacks: ["ALIBABA_API_KEY"],
    defaultModel: "qwen3-coder-plus",
    extraHeaders: {},
  },
  supergrok: {
    id: "supergrok",
    label: "SuperGrok",
    protocol: "openai",
    baseUrl: "https://api.x.ai/v1",
    authEnv: "XAI_API_KEY",
    authEnvFallbacks: ["SUPERGROK_API_KEY"],
    defaultModel: "grok-4",
    extraHeaders: {},
  },
  "opencode-go": {
    id: "opencode-go",
    label: "OpenCode Go",
    protocol: "openai",
    baseUrl: "https://opencode.ai/zen/go/v1",
    authEnv: "OPENCODE_API_KEY",
    authEnvFallbacks: [],
    defaultModel: "gpt-5.3-codex",
    extraHeaders: {},
  },
  kimi: {
    id: "kimi",
    label: "Kimi",
    protocol: "openai",
    baseUrl: "https://api.moonshot.ai/v1",
    authEnv: "MOONSHOT_API_KEY",
    authEnvFallbacks: ["KIMI_API_KEY"],
    defaultModel: "kimi-k2.5",
    extraHeaders: {},
  },
  antigravity: {
    id: "antigravity",
    label: "Antigravity",
    protocol: "openai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    authEnv: "ANTIGRAVITY_API_KEY",
    authEnvFallbacks: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    defaultModel: "gemini-2.5-pro",
    extraHeaders: {},
  },
};

const DEFAULT_INTENT_ROUTES: Config["intents"] = {
  spec: { plan: "kimi", model: "kimi-k2.5", fallbacks: [] },
  "spec-review": { plan: "codex", model: "gpt-5.3-codex", fallbacks: [] },
  plan: { plan: "kimi", model: "kimi-k2.5", fallbacks: [] },
  "plan-review": { plan: "supergrok", model: "grok-4", fallbacks: [] },
  build: { plan: "codex", model: "gpt-5.3-codex", fallbacks: [] },
  "build-review": { plan: "supergrok", model: "grok-4", fallbacks: [] },
  ship: { plan: "opencode-go", model: "gpt-5.3-codex", fallbacks: [] },
};

export function defaultConfig(): Config {
  return {
    schemaVersion: 1,
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    defaultIntent: "build",
    requireToken: false,
    plans: structuredClone(DEFAULT_PLANS),
    intents: structuredClone(DEFAULT_INTENT_ROUTES),
    windows: {
      fiveHour: {
        maxCalls: null,
        maxTokens: null,
        maxCostUsd: null,
        onExceed: "warn",
      },
      week: {
        maxCalls: null,
        maxTokens: null,
        maxCostUsd: null,
        onExceed: "warn",
      },
      month: {
        maxCalls: null,
        maxTokens: null,
        maxCostUsd: null,
        onExceed: "warn",
      },
    },
    pricing: {
      "gpt-5.3-codex": { inputPerMillion: 1.75, outputPerMillion: 14 },
      "glm-4.6": { inputPerMillion: 0.6, outputPerMillion: 2.2 },
      "qwen3-coder-plus": { inputPerMillion: 1, outputPerMillion: 5 },
      "grok-4": { inputPerMillion: 3, outputPerMillion: 15 },
      "kimi-k2.5": { inputPerMillion: 0.6, outputPerMillion: 2.5 },
      "gemini-2.5-pro": { inputPerMillion: 1.25, outputPerMillion: 10 },
    },
  };
}

export function isCodeIntent(value: string): boolean {
  return (CODE_INTENTS as readonly string[]).includes(value);
}
