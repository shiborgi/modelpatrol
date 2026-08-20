import { z } from "zod";

import {
  CONFIG_SCHEMA_VERSION,
  ON_EXCEED,
  PROTOCOLS,
  WINDOW_IDS,
} from "./constants.js";

export const protocolSchema = z.enum(PROTOCOLS);
export const onExceedSchema = z.enum(ON_EXCEED);
export const windowIdSchema = z.enum(WINDOW_IDS);

export const planDefinitionSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    protocol: protocolSchema,
    baseUrl: z.string().url(),
    authEnv: z.string().min(1),
    authEnvFallbacks: z.array(z.string().min(1)).default([]),
    defaultModel: z.string().min(1),
    extraHeaders: z.record(z.string(), z.string()).default({}),
  })
  .strict();

export const intentFallbackSchema = z
  .object({
    plan: z.string().min(1),
    model: z.string().min(1),
  })
  .strict();

export const intentRouteSchema = z
  .object({
    plan: z.string().min(1),
    model: z.string().min(1),
    fallbacks: z.array(intentFallbackSchema).default([]),
  })
  .strict();

export const windowCapSchema = z
  .object({
    maxCalls: z.number().int().nonnegative().nullable().default(null),
    maxTokens: z.number().int().nonnegative().nullable().default(null),
    maxCostUsd: z.number().nonnegative().nullable().default(null),
    onExceed: onExceedSchema.default("warn"),
  })
  .strict();

export const modelPriceSchema = z
  .object({
    inputPerMillion: z.number().nonnegative(),
    outputPerMillion: z.number().nonnegative(),
  })
  .strict();

export const configSchema = z
  .object({
    schemaVersion: z.literal(CONFIG_SCHEMA_VERSION),
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    defaultIntent: z.string().min(1),
    requireToken: z.boolean(),
    plans: z.record(z.string(), planDefinitionSchema),
    intents: z.record(z.string(), intentRouteSchema),
    windows: z.object({
      fiveHour: windowCapSchema,
      week: windowCapSchema,
      month: windowCapSchema,
    }),
    pricing: z.record(z.string(), modelPriceSchema),
  })
  .strict();

export const ledgerEventSchema = z
  .object({
    id: z.string().min(1),
    ts: z.string().min(1),
    intent: z.string().min(1),
    plan: z.string().min(1),
    model: z.string().min(1),
    protocol: protocolSchema,
    harness: z.string().min(1).nullable(),
    promptTokens: z.number().nonnegative(),
    completionTokens: z.number().nonnegative(),
    totalTokens: z.number().nonnegative(),
    costUsd: z.number().nonnegative(),
    status: z.number().int(),
    latencyMs: z.number().nonnegative(),
    streamed: z.boolean(),
    error: z.string().nullable(),
  })
  .strict();
