import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { CATALOG, providerPlan, requireProvider } from "../catalog/catalog.js";
import { ModelpatrolError } from "../core/errors.js";
import { resolvePlanKey } from "../routing/resolve.js";
import { joinUrl } from "./forward.js";

export interface UsageWindowAvailable {
  available: true;
  used: number | null;
  remaining: number | null;
  limit: number | null;
  resetAt?: string;
}

export type UsageWindowMissingReason = "unsupported" | "unauthenticated" | "upstream";

export interface UsageWindowMissing {
  available: false;
  reason: UsageWindowMissingReason;
}

export type UsageWindow = UsageWindowAvailable | UsageWindowMissing;

export interface ProviderUsageReset {
  id: string;
  resetAt: string;
  kind: "rate_limit";
}

export interface ProviderUsage {
  provider: string;
  windows: {
    fiveHour: UsageWindow;
    week: UsageWindow;
    month: UsageWindow;
  };
  resets?: ProviderUsageReset[];
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
  const fetchImpl = _deps.fetchImpl ?? fetch;
  const plan = providerPlan(provider);
  let key: string;
  try {
    key = await resolvePlanKey(plan, _deps.env ?? process.env, _deps.home);
  } catch (error) {
    if (error instanceof ModelpatrolError && error.code === "PLAN_UNAUTHENTICATED") {
      return unavailable(provider.id, "unsupported");
    }
    throw error;
  }
  let response: Response;
  try {
    response = await fetchImpl(joinUrl(plan.baseUrl, "/models"), {
      headers: { authorization: `Bearer ${key}` },
    });
  } catch {
    return unavailable(provider.id, "upstream");
  }
  if (response.status === 401) return unavailable(provider.id, "unauthenticated");
  if (!response.ok) return unavailable(provider.id, "upstream");
  const resets = [
    rateLimitReset(
      "requests",
      response.headers.get("x-ratelimit-reset-requests"),
      response.headers.get("x-ratelimit-remaining-requests"),
    ),
    rateLimitReset(
      "tokens",
      response.headers.get("x-ratelimit-reset-tokens"),
      response.headers.get("x-ratelimit-remaining-tokens"),
    ),
  ].filter((value): value is ProviderUsageReset => value !== null);
  return {
    ...unavailable(provider.id, "unsupported"),
    ...(resets.length > 0 ? { resets } : {}),
  };
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
  const usage = await adapter(deps);
  persistResets(deps.home, usage);
  return usage;
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
  const remaining = numberOrNull(rec.remaining);
  const limit = numberOrNull(rec.limit ?? rec.max);
  const resetAt = exhaustedResetAt(rec, remaining, limit);
  return {
    available: true,
    used: n,
    remaining,
    limit,
    ...(resetAt ? { resetAt } : {}),
  };
}

function exhaustedResetAt(
  value: Record<string, unknown>,
  remaining: number | null,
  limit: number | null,
): string | null {
  if (
    remaining !== 0 &&
    !(limit !== null && nFinite(value.used) && Number(value.used) >= limit)
  ) {
    return null;
  }
  const raw = value.resetAt ?? value.reset_at ?? value.resetsAt ?? value.resets_at;
  const date = new Date(typeof raw === "number" ? raw * 1000 : String(raw ?? ""));
  return Number.isFinite(date.getTime()) && date.getTime() > Date.now()
    ? date.toISOString()
    : null;
}

function rateLimitReset(
  id: string,
  raw: string | null,
  remainingRaw: string | null,
): ProviderUsageReset | null {
  if (!raw || remainingRaw === null || Number(remainingRaw) > 0) return null;
  const numeric = Number(raw);
  const now = Date.now();
  const milliseconds = Number.isFinite(numeric)
    ? numeric > 1_000_000_000_000
      ? numeric
      : numeric > 1_000_000_000
        ? numeric * 1000
        : now + numeric * 1000
    : Date.parse(raw);
  if (!Number.isFinite(milliseconds) || milliseconds <= now) return null;
  return { id, kind: "rate_limit", resetAt: new Date(milliseconds).toISOString() };
}

function persistResets(home: string | undefined, usage: ProviderUsage): void {
  if (!home) return;
  const windows = Object.entries(usage.windows).flatMap(([id, value]) =>
    value.available && value.resetAt
      ? [{ id, resetAt: value.resetAt, kind: "usage_window" }]
      : [],
  );
  const resets = [...windows, ...(usage.resets ?? [])];
  if (resets.length === 0) return;
  const path = join(home, "usage-resets.json");
  try {
    const previous = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const next = { ...previous, [usage.provider]: resets };
    writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    chmodSync(path, 0o600);
  } catch {
    try {
      writeFileSync(
        path,
        `${JSON.stringify({ [usage.provider]: resets }, null, 2)}\n`,
        {
          mode: 0o600,
        },
      );
      chmodSync(path, 0o600);
    } catch {
      return;
    }
  }
}

function numberOrNull(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nFinite(value: unknown): boolean {
  return Number.isFinite(Number(value));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
