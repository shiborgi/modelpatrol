import { refreshAccessToken as refreshCodexAccessToken } from "../auth/codex-oauth.js";
import { inspectCredential, readCredential, writeCredential } from "../auth/store.js";
import { accessTokenIsExpiring, refreshAccessToken } from "../auth/xai-oauth.js";
import { ModelpatrolError } from "../core/errors.js";
import type { Config, PlanDefinition, ResolvedRoute } from "../core/model.js";

export function resolveRoute(config: Config, intent: string): ResolvedRoute {
  const route = config.intents[intent];
  if (!route) {
    throw new ModelpatrolError("INTENT_UNKNOWN", `no mapping for intent "${intent}"`);
  }
  const plan = requirePlan(config, route.plan);
  return {
    intent,
    plan,
    model: route.model || plan.defaultModel,
    fallbacks: route.fallbacks.map((item) => ({
      plan: requirePlan(config, item.plan),
      model: item.model,
    })),
  };
}

export function requirePlan(config: Config, planId: string): PlanDefinition {
  const plan = config.plans[planId];
  if (!plan) {
    throw new ModelpatrolError("PLAN_UNKNOWN", `unknown plan "${planId}"`);
  }
  return plan;
}

const inFlightRefreshes = new Map<string, Promise<string>>();

export interface ResolveKeyOptions {
  fetchImpl?: typeof fetch;
}

export async function resolvePlanKey(
  plan: PlanDefinition,
  env: NodeJS.ProcessEnv = process.env,
  home?: string,
  options: ResolveKeyOptions = {},
): Promise<string> {
  const names = [plan.authEnv, ...plan.authEnvFallbacks];
  for (const name of names) {
    const value = env[name];
    if (value?.trim()) {
      return value.trim();
    }
  }

  if (home) {
    const oauthId = resolveOauthId(plan);
    if (oauthId) {
      const stored = readCredential(home, oauthId);
      if (stored) {
        const expiresSoon =
          !stored.expires ||
          stored.expires - Date.now() <= 120_000 ||
          accessTokenIsExpiring(stored.access);

        if (expiresSoon) {
          const refreshKey = `${home}:${oauthId}`;
          let promise = inFlightRefreshes.get(refreshKey);
          if (!promise) {
            promise = (async () => {
              try {
                const refreshed =
                  oauthId === "codex"
                    ? await refreshCodexAccessToken(stored.refresh, {
                        fetchImpl: options.fetchImpl,
                      })
                    : await refreshAccessToken(stored.refresh, {
                        fetchImpl: options.fetchImpl,
                      });
                const newExpires = Date.now() + (refreshed.expires_in ?? 3600) * 1000;
                const newRefresh = refreshed.refresh_token || stored.refresh;
                writeCredential(home, oauthId, {
                  access: refreshed.access_token,
                  refresh: newRefresh,
                  expires: newExpires,
                  tokenType: refreshed.token_type,
                });
                return refreshed.access_token;
              } catch {
                return stored.access;
              } finally {
                inFlightRefreshes.delete(refreshKey);
              }
            })();
            inFlightRefreshes.set(refreshKey, promise);
          }
          return await promise;
        }
        return stored.access;
      }
    }
  }

  throw new ModelpatrolError(
    "PLAN_UNAUTHENTICATED",
    `plan "${plan.id}" missing ${names.join(" or ")}`,
  );
}

export function planHasKey(
  plan: PlanDefinition,
  env: NodeJS.ProcessEnv = process.env,
  home?: string,
): boolean {
  const names = [plan.authEnv, ...plan.authEnvFallbacks];
  for (const name of names) {
    const value = env[name];
    if (value?.trim()) {
      return true;
    }
  }
  if (home) {
    const oauthId = resolveOauthId(plan);
    if (oauthId) {
      return inspectCredential(home, oauthId).status === "valid";
    }
  }
  return false;
}

/** The OAuth credential id a plan uses, if any. Backward compatible with supergrok. */
export function resolveOauthId(plan: PlanDefinition): string | null {
  if (plan.oauthPlan) {
    return plan.oauthPlan;
  }
  return plan.id === "supergrok" ? "supergrok" : null;
}
