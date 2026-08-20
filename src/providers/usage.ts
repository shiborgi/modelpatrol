import { CATALOG, providerPlan, requireProvider } from "../catalog/catalog.js";
import { ModelpatrolError } from "../core/errors.js";
import { resolvePlanKey } from "../routing/resolve.js";
import { joinUrl } from "./forward.js";

export interface UsageWindowAvailable {
  available: true;
  used: number | null;
  remaining: number | null;
  limit: number | null;
}

export type UsageWindowMissingReason = "unsupported" | "unauthenticated" | "upstream";

export interface UsageWindowMissing {
  available: false;
  reason: UsageWindowMissingReason;
}

export type UsageWindow = UsageWindowAvailable | UsageWindowMissing;

export interface ProviderUsage {
  provider: string;
  windows: {
    fiveHour: UsageWindow;
    week: UsageWindow;
    month: UsageWindow;
  };
}

export interface UsageDeps {
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  home?: string;
}

function unavailable(
  provider: string,
  reason: UsageWindowMissingReason,
): ProviderUsage {
  return {
    provider,
    windows: {
      fiveHour: { available: false, reason },
      week: { available: false, reason },
      month: { available: false, reason },
    },
  };
}

export async function openaiUsage(deps: UsageDeps): Promise<ProviderUsage> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const provider = requireProvider(CATALOG, "openai");
  const plan = providerPlan(provider);
  const key = await resolvePlanKey(plan, deps.env ?? process.env, deps.home);

  let response: Response;
  try {
    response = await fetchImpl(
      joinUrl(plan.baseUrl, "/organization/usage/completions"),
      {
        headers: { authorization: `Bearer ${key}` },
      },
    );
  } catch {
    return unavailable(provider.id, "upstream");
  }

  if (response.status === 401) {
    return unavailable(provider.id, "unauthenticated");
  }
  if (!response.ok) {
    return unavailable(provider.id, "upstream");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return unavailable(provider.id, "upstream");
  }

  const windows = inferOpenaiWindows(payload);
  return { provider: provider.id, windows };
}

export async function xaiUsage(_deps: UsageDeps): Promise<ProviderUsage> {
  const provider = requireProvider(CATALOG, "xai");
  return unavailable(provider.id, "unsupported");
}

export type ProviderUsageAdapter = (deps: UsageDeps) => Promise<ProviderUsage>;

export const USAGE_ADAPTERS: Record<string, ProviderUsageAdapter> = {
  openai: openaiUsage,
  xai: xaiUsage,
};

export async function fetchProviderUsage(
  providerId: string,
  deps: UsageDeps = {},
): Promise<ProviderUsage> {
  const adapter = USAGE_ADAPTERS[providerId];
  if (!adapter) {
    throw new ModelpatrolError("PROVIDER_UNKNOWN", `unknown provider "${providerId}"`);
  }
  return adapter(deps);
}

function inferOpenaiWindows(payload: unknown): ProviderUsage["windows"] {
  const record = asRecord(payload);
  const result = asRecord(record.result);
  return {
    fiveHour: { available: false, reason: "unsupported" },
    week: bucketWindow(result.week ?? result["7d"]),
    month: bucketWindow(result.month ?? result["30d"]),
  };
}

function bucketWindow(value: unknown): UsageWindow {
  const rec = asRecord(value);
  const n = Number(rec.used ?? rec.value ?? rec.total_tokens);
  if (!Number.isFinite(n)) {
    return { available: false, reason: "unsupported" };
  }
  return { available: true, used: n, remaining: null, limit: null };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
