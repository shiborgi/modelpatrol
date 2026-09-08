import { readFile } from "node:fs/promises";
import { join } from "node:path";

const MARKER = "billing: fetched credits config";
const number = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
const text = (value) =>
  typeof value === "string" && value.length > 0 ? value : null;

// Reads the billing snapshot the official grok CLI logs on startup to
// ~/.grok/logs/unified.jsonl. This is local CLI state (like the Codex and
// Claude account readers): no network calls, no credentials touched, only
// parsed numbers leave this module. The snapshot carries the weekly credit
// window; session-level usage is not reported, so callers must render the
// session columns as unknown rather than estimating them.
export async function grokUsage({ logPath, home = process.env.HOME } = {}) {
  const path =
    logPath ?? (home ? join(home, ".grok", "logs", "unified.jsonl") : null);
  if (!path) throw new Error("Grok home directory is unknown");
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error("Grok usage log is not available");
  }
  const lines = raw.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line || !line.includes(MARKER)) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const config = entry?.ctx?.config;
    if (!config || typeof config !== "object") continue;
    return {
      tier: text(entry?.ctx?.subscriptionTier) ?? text(config?.subscriptionTier),
      creditUsagePercent: number(config.creditUsagePercent),
      period: {
        type: text(config.currentPeriod?.type),
        start: text(config.currentPeriod?.start),
        end: text(config.currentPeriod?.end),
      },
      asOf: text(entry?.ts),
      fetchedAt: new Date().toISOString(),
    };
  }
  throw new Error("No Grok billing snapshot in usage log");
}
