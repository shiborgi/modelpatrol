import type { LevelId, OnExceed, Protocol, WindowId } from "./constants.js";

export interface PlanDefinition {
  id: string;
  label: string;
  protocol: Protocol;
  baseUrl: string;
  authEnv: string;
  authEnvFallbacks: string[];
  defaultModel: string;
  extraHeaders: Record<string, string>;
  oauthPlan?: string;
}

export interface CatalogLevel {
  id: LevelId;
  reasoning: string | null;
}

export interface CatalogModel {
  id: string;
  levels: CatalogLevel[];
}

export interface CatalogProvider {
  id: string;
  label: string;
  protocol: Protocol;
  baseUrl: string;
  authEnv: string;
  authEnvFallbacks: string[];
  oauthPlan?: string;
  models: CatalogModel[];
}

export interface CatalogRoute {
  provider: CatalogProvider;
  model: CatalogModel;
  level: LevelId;
  reasoning: string | null;
  plan: PlanDefinition;
}

export interface IntentFallback {
  plan: string;
  model: string;
}

export interface IntentRoute {
  plan: string;
  model: string;
  fallbacks: IntentFallback[];
}

export interface WindowCap {
  maxCalls: number | null;
  maxTokens: number | null;
  maxCostUsd: number | null;
  onExceed: OnExceed;
}

export interface ModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
}

export interface Config {
  schemaVersion: 1;
  host: string;
  port: number;
  defaultIntent: string;
  requireToken: boolean;
  plans: Record<string, PlanDefinition>;
  intents: Record<string, IntentRoute>;
  windows: Record<WindowId, WindowCap>;
  pricing: Record<string, ModelPrice>;
}

export interface LedgerEvent {
  id: string;
  ts: string;
  intent: string;
  plan: string;
  model: string;
  provider: string | null;
  level: string | null;
  protocol: Protocol;
  harness: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  status: number;
  latencyMs: number;
  streamed: boolean;
  error: string | null;
}

export interface SliceTotals {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface WindowSnapshot {
  window: WindowId;
  since: string;
  totals: SliceTotals;
  byPlan: Record<string, SliceTotals>;
  byIntent: Record<string, SliceTotals>;
}

export interface ResolvedRoute {
  intent: string;
  plan: PlanDefinition;
  model: string;
  fallbacks: Array<{ plan: PlanDefinition; model: string }>;
}

export interface UsageReport {
  generatedAt: string;
  windows: WindowSnapshot[];
}

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}
