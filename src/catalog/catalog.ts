import { LEVEL_IDS, type LevelId } from "../core/constants.js";
import { ModelpatrolError } from "../core/errors.js";
import type {
  CatalogModel,
  CatalogProvider,
  CatalogRoute,
  PlanDefinition,
} from "../core/model.js";

export const CATALOG: Record<string, CatalogProvider> = {
  xai: {
    id: "xai",
    label: "xAI",
    protocol: "openai",
    baseUrl: "https://api.x.ai/v1",
    authEnv: "XAI_API_KEY",
    authEnvFallbacks: ["SUPERGROK_API_KEY"],
    oauthPlan: "supergrok",
    models: [
      {
        id: "grok-4.6",
        levels: [
          { id: "default", reasoning: null },
          { id: "high", reasoning: "high" },
          { id: "max", reasoning: "xhigh" },
        ],
      },
      {
        id: "grok-build-0.1",
        levels: [
          { id: "default", reasoning: null },
          { id: "high", reasoning: "high" },
          { id: "max", reasoning: "high" },
        ],
      },
    ],
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    authEnv: "OPENAI_API_KEY",
    authEnvFallbacks: ["CODEX_API_KEY"],
    models: [
      {
        id: "gpt-5.6-luna",
        levels: [
          { id: "default", reasoning: null },
          { id: "high", reasoning: "high" },
          { id: "max", reasoning: "xhigh" },
        ],
      },
      {
        id: "gpt-5.6-sol",
        levels: [
          { id: "default", reasoning: null },
          { id: "high", reasoning: "high" },
          { id: "max", reasoning: "xhigh" },
        ],
      },
      {
        id: "gpt-5.6-terra",
        levels: [
          { id: "default", reasoning: null },
          { id: "high", reasoning: "high" },
          { id: "max", reasoning: "xhigh" },
        ],
      },
    ],
  },
};

export function requireProvider(
  catalog: Record<string, CatalogProvider>,
  providerId: string,
): CatalogProvider {
  const provider = catalog[providerId];
  if (!provider) {
    throw new ModelpatrolError("PROVIDER_UNKNOWN", `unknown provider "${providerId}"`);
  }
  return provider;
}

export function requireModel(provider: CatalogProvider, modelId: string): CatalogModel {
  const model = provider.models.find((m) => m.id === modelId);
  if (!model) {
    throw new ModelpatrolError(
      "MODEL_UNKNOWN",
      `model "${modelId}" not offered by provider "${provider.id}"`,
    );
  }
  return model;
}

export function requireLevel(model: CatalogModel, levelId: string | null): LevelId {
  const id = levelId ?? "default";
  if (!(LEVEL_IDS as readonly string[]).includes(id)) {
    throw new ModelpatrolError("USAGE", `unsupported level "${id}"`);
  }
  return id as LevelId;
}

export function levelReasoning(model: CatalogModel, level: LevelId): string | null {
  return model.levels.find((l) => l.id === level)?.reasoning ?? null;
}

export function resolveCatalogRoute(
  catalog: Record<string, CatalogProvider>,
  providerId: string,
  modelId: string,
  levelId?: string | null,
): CatalogRoute {
  const provider = requireProvider(catalog, providerId);
  const model = requireModel(provider, modelId);
  const level = requireLevel(model, levelId ?? null);
  const reasoning = levelReasoning(model, level);
  return {
    provider,
    model,
    level,
    reasoning,
    plan: catalogToPlan(provider, modelId),
  };
}

function catalogToPlan(provider: CatalogProvider, modelId: string): PlanDefinition {
  return {
    id: provider.id,
    label: provider.label,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    authEnv: provider.authEnv,
    authEnvFallbacks: provider.authEnvFallbacks,
    defaultModel: modelId,
    extraHeaders: {},
    ...(provider.oauthPlan ? { oauthPlan: provider.oauthPlan } : {}),
  };
}
