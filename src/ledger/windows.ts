import { WINDOW_IDS, WINDOW_MS, type WindowId } from "../core/constants.js";
import { ModelpatrolError } from "../core/errors.js";
import type {
  Config,
  LedgerEvent,
  SliceTotals,
  WindowSnapshot,
} from "../core/model.js";

export function emptySlice(): SliceTotals {
  return {
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costUsd: 0,
  };
}

export function addEvent(slice: SliceTotals, event: LedgerEvent): void {
  slice.calls += 1;
  slice.promptTokens += event.promptTokens;
  slice.completionTokens += event.completionTokens;
  slice.totalTokens += event.totalTokens;
  slice.costUsd += event.costUsd;
}

export function snapshotWindow(
  events: LedgerEvent[],
  window: WindowId,
  now: Date,
): WindowSnapshot {
  const sinceMs = now.getTime() - WINDOW_MS[window];
  const since = new Date(sinceMs).toISOString();
  const totals = emptySlice();
  const byPlan: Record<string, SliceTotals> = {};
  const byIntent: Record<string, SliceTotals> = {};
  for (const event of events) {
    const ts = Date.parse(event.ts);
    if (Number.isNaN(ts) || ts < sinceMs) {
      continue;
    }
    addEvent(totals, event);
    let planSlice = byPlan[event.plan];
    if (!planSlice) {
      planSlice = emptySlice();
      byPlan[event.plan] = planSlice;
    }
    addEvent(planSlice, event);
    let intentSlice = byIntent[event.intent];
    if (!intentSlice) {
      intentSlice = emptySlice();
      byIntent[event.intent] = intentSlice;
    }
    addEvent(intentSlice, event);
  }
  totals.costUsd = round6(totals.costUsd);
  return { window, since, totals, byPlan, byIntent };
}

export function snapshotAll(events: LedgerEvent[], now = new Date()): WindowSnapshot[] {
  return WINDOW_IDS.map((window) => snapshotWindow(events, window, now));
}

export interface WindowBreach {
  window: WindowId;
  reason: string;
  onExceed: "warn" | "block";
}

export function evaluateWindows(
  config: Config,
  snapshots: WindowSnapshot[],
): WindowBreach[] {
  const breaches: WindowBreach[] = [];
  for (const snap of snapshots) {
    const cap = config.windows[snap.window];
    if (cap.maxCalls !== null && snap.totals.calls >= cap.maxCalls) {
      breaches.push({
        window: snap.window,
        reason: `calls ${snap.totals.calls} >= ${cap.maxCalls}`,
        onExceed: cap.onExceed,
      });
    }
    if (cap.maxTokens !== null && snap.totals.totalTokens >= cap.maxTokens) {
      breaches.push({
        window: snap.window,
        reason: `tokens ${snap.totals.totalTokens} >= ${cap.maxTokens}`,
        onExceed: cap.onExceed,
      });
    }
    if (cap.maxCostUsd !== null && snap.totals.costUsd >= cap.maxCostUsd) {
      breaches.push({
        window: snap.window,
        reason: `cost ${snap.totals.costUsd} >= ${cap.maxCostUsd}`,
        onExceed: cap.onExceed,
      });
    }
  }
  return breaches;
}

export function assertWindowsAllow(
  config: Config,
  snapshots: WindowSnapshot[],
): WindowBreach[] {
  const breaches = evaluateWindows(config, snapshots);
  const blocked = breaches.filter((item) => item.onExceed === "block");
  if (blocked[0]) {
    throw new ModelpatrolError(
      "WINDOW_EXCEEDED",
      `${blocked[0].window} window exceeded (${blocked[0].reason})`,
    );
  }
  return breaches;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
