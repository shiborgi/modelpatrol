import { codexUsage } from "./codex-account.mjs";
import { claudeUsage } from "./claude-account.mjs";
import { grokUsage } from "./grok-account.mjs";
import { ollamaUsage } from "./ollama-account.mjs";
import { agyUsage } from "./antigravity-account.mjs";

const snapshot = (limits, fetchedAt = new Date().toISOString()) => ({
  protocolVersion: "1.0", status: "available", fetchedAt, limits,
});
const percent = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value / 100
    : null;
const fraction = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
const limit = (id, window, usedFraction, resetsAt) => ({
  id, window, usedFraction, remainingFraction: null, resetsAt: resetsAt ?? null,
});

// Centralized, read-only account adapters. They deliberately return
// unavailable rather than guessing whenever a local CLI/API cannot report a
// quota. This keeps the dashboard truthful without a connector per provider.
export async function centralUsage(provider, env = process.env) {
  const id = String(provider.transport?.adapter ?? provider.usageAdapter ?? provider.id ?? "").toLowerCase();
  try {
    if (id.includes("codex")) {
      const account = await codexUsage();
      const limits = account.limits?.rateLimits ?? {};
      return snapshot([
        limit("session", "rolling", percent(limits.primary?.usedPercent), limits.primary?.resetsAt),
        limit("week", "calendar", percent(limits.secondary?.usedPercent), limits.secondary?.resetsAt),
      ], account.fetchedAt);
    }
    if (id.includes("claude")) {
      const usage = await claudeUsage();
      return snapshot([
        limit("session", "rolling", percent(usage.session?.usedPercent), usage.session?.resetsAt),
        limit("week", "calendar", percent(usage.week?.usedPercent), usage.week?.resetsAt),
      ], usage.fetchedAt);
    }
    if (id.includes("grok")) {
      const usage = await grokUsage();
      return snapshot([
        limit("session", "rolling", null, null),
        limit("week", "calendar", percent(usage.creditUsagePercent), usage.period?.end),
      ], usage.fetchedAt);
    }
    if (id.includes("ollama")) {
      const usage = await ollamaUsage(env[provider.apiKeyEnv]);
      return snapshot([
        limit("session", "rolling", fraction(usage.session?.usedFraction), null),
        limit("week", "calendar", fraction(usage.weekly?.usedFraction), null),
      ], usage.fetchedAt);
    }
    if (id.includes("antigravity")) {
      const usage = await agyUsage({ cwd: env.MODELPATROL_ANTIGRAVITY_WORKSPACE });
      const buckets = usage.groups.flatMap((group) => group.buckets);
      const session = buckets.find((bucket) => /5h|hour|session/i.test(bucket.window ?? ""));
      const week = buckets.find((bucket) => /week/i.test(bucket.window ?? ""));
      return snapshot([
        limit("session", "rolling", session?.remainingFraction === null || session?.remainingFraction === undefined ? null : 1 - session.remainingFraction, session?.resetTime),
        limit("week", "calendar", week?.remainingFraction === null || week?.remainingFraction === undefined ? null : 1 - week.remainingFraction, week?.resetTime),
      ], usage.fetchedAt);
    }
  } catch {
    // The provider may not be signed in, its CLI may be absent, or it may not
    // currently disclose limits. None of those justify a fabricated value.
  }
  return { protocolVersion: "1.0", status: "unavailable", fetchedAt: null, limits: [] };
}
