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

export function resolvePlanKey(
  plan: PlanDefinition,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const names = [plan.authEnv, ...plan.authEnvFallbacks];
  for (const name of names) {
    const value = env[name];
    if (value?.trim()) {
      return value.trim();
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
): boolean {
  try {
    resolvePlanKey(plan, env);
    return true;
  } catch {
    return false;
  }
}
