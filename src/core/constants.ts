export const CONFIG_SCHEMA_VERSION = 1 as const;
export const DEFAULT_PORT = 4200;
export const DEFAULT_HOST = "127.0.0.1";

export const WINDOW_IDS = ["fiveHour", "week", "month"] as const;
export type WindowId = (typeof WINDOW_IDS)[number];

export const WINDOW_MS: Record<WindowId, number> = {
  fiveHour: 5 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
};

export const CODE_INTENTS = [
  "spec",
  "spec-review",
  "plan",
  "plan-review",
  "build",
  "build-review",
  "ship",
] as const;

export type CodeIntent = (typeof CODE_INTENTS)[number];

export const BUILTIN_PLAN_IDS = [
  "codex",
  "zai",
  "alibaba",
  "supergrok",
  "opencode-go",
  "kimi",
  "antigravity",
] as const;

export type BuiltinPlanId = (typeof BUILTIN_PLAN_IDS)[number];

export const PROTOCOLS = ["openai", "anthropic"] as const;
export type Protocol = (typeof PROTOCOLS)[number];

export const ON_EXCEED = ["warn", "block"] as const;
export type OnExceed = (typeof ON_EXCEED)[number];

export const INTENT_HEADER = "x-modelpatrol-intent";
export const HARNESS_HEADER = "x-modelpatrol-harness";
export const PROVIDER_HEADER = "x-modelpatrol-provider";
export const MODEL_HEADER = "x-modelpatrol-model";
export const LEVEL_HEADER = "x-modelpatrol-level";

export const LEVEL_IDS = ["default", "high", "max"] as const;
export type LevelId = (typeof LEVEL_IDS)[number];
