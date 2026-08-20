import type { IncomingMessage, ServerResponse } from "node:http";
import { CATALOG, resolveCatalogRoute } from "../catalog/catalog.js";
import { loadConfig } from "../config/load.js";
import { INTENT_HEADER } from "../core/constants.js";
import { ModelpatrolError } from "../core/errors.js";
import { newId } from "../core/ids.js";
import type { Config, LedgerEvent } from "../core/model.js";
import { estimateCostUsd, estimateTokensFromText } from "../ledger/pricing.js";
import { appendEvent, readEvents } from "../ledger/store.js";
import { assertWindowsAllow, snapshotAll } from "../ledger/windows.js";
import { forwardJson } from "../providers/forward.js";
import {
  applyReasoning,
  asRecord,
  extractSseUsage,
  extractUsage,
  inboundProtocol,
  type JsonRecord,
  rewriteResponseModel,
  translateBody,
} from "../providers/translate.js";
import {
  extractHarness,
  extractIntent,
  extractProviderModelLevel,
} from "../routing/intent.js";
import { resolveRoute } from "../routing/resolve.js";

export interface ProxyContext {
  home: string;
  config: Config;
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
  now: () => Date;
}

export function createContext(
  home: string,
  overrides: Partial<Omit<ProxyContext, "home" | "config">> = {},
): ProxyContext {
  return {
    home,
    config: loadConfig(home).config,
    env: overrides.env ?? process.env,
    fetchImpl: overrides.fetchImpl ?? fetch,
    now: overrides.now ?? (() => new Date()),
  };
}

export async function handleHttp(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ProxyContext,
): Promise<void> {
  const host = req.headers.host ?? "127.0.0.1";
  const url = new URL(req.url ?? "/", `http://${host}`);
  if (req.method === "OPTIONS") {
    writeCors(res);
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true, service: "modelpatrol" });
    return;
  }
  if (
    req.method === "GET" &&
    (url.pathname === "/v1/status" || url.pathname === "/status")
  ) {
    json(res, 200, statusPayload(ctx));
    return;
  }
  if (
    req.method === "GET" &&
    (url.pathname === "/v1/usage" || url.pathname === "/usage")
  ) {
    json(res, 200, usagePayload(ctx));
    return;
  }
  if (req.method === "GET" && url.pathname === "/v1/models") {
    json(res, 200, modelsPayload(ctx.config));
    return;
  }
  if (ctx.config.requireToken && !tokenOk(req, ctx.env)) {
    json(res, 401, { error: { message: "invalid modelpatrol token", type: "auth" } });
    return;
  }

  const protocol = inboundProtocol(url.pathname);
  if (req.method !== "POST" || !protocol) {
    json(res, 404, { error: { message: `unsupported ${req.method} ${url.pathname}` } });
    return;
  }

  const raw = await readBody(req);
  let body: JsonRecord = {};
  if (raw) {
    try {
      body = asRecord(JSON.parse(raw));
    } catch {
      json(res, 400, { error: { message: "request body is not valid JSON" } });
      return;
    }
  }

  const started = ctx.now();
  const inboundModel = typeof body.model === "string" ? body.model : null;
  const providerModelLevel = extractProviderModelLevel({
    headers: req.headers,
    model: inboundModel,
  });
  const harness = extractHarness(req.headers);
  const streamed = body.stream === true;

  try {
    const events = readEvents(ctx.home);
    const warnings = assertWindowsAllow(ctx.config, snapshotAll(events, started));

    if (providerModelLevel) {
      const catalogRoute = resolveCatalogRoute(
        CATALOG,
        providerModelLevel.provider,
        providerModelLevel.model,
        providerModelLevel.level ?? null,
      );
      const translated = translateBody(
        body,
        protocol,
        catalogRoute.plan.protocol,
        catalogRoute.model.id,
      );
      const outgoing = applyReasoning(translated.body, catalogRoute.reasoning);
      const upstream = await forwardJson({
        plan: catalogRoute.plan,
        path: translated.path,
        body: outgoing,
        protocol: catalogRoute.plan.protocol,
        stream: streamed,
        env: ctx.env,
        home: ctx.home,
        fetchImpl: ctx.fetchImpl,
      });
      const usage = streamed
        ? extractSseUsage(upstream.body)
        : extractUsage(parseJson(upstream.body));
      const estimatedPrompt =
        usage.promptTokens ||
        estimateTokensFromText(JSON.stringify(body.messages ?? body.input ?? ""));
      const estimatedCompletion =
        usage.completionTokens ||
        estimateTokensFromText(extractOutputText(upstream.body));
      record(ctx, {
        intent: catalogRoute.model.id,
        plan: catalogRoute.plan.id,
        model: catalogRoute.model.id,
        provider: catalogRoute.provider.id,
        level: catalogRoute.level,
        protocol: catalogRoute.plan.protocol,
        harness,
        promptTokens: estimatedPrompt,
        completionTokens: estimatedCompletion,
        status: upstream.status,
        latencyMs: ctx.now().getTime() - started.getTime(),
        streamed,
        error: upstream.status >= 400 ? truncate(upstream.body) : null,
      });
      writeCors(res);
      res.writeHead(upstream.status, {
        "content-type": streamed
          ? (upstream.headers.get("content-type") ?? "text/event-stream")
          : "application/json",
        "x-modelpatrol-provider": catalogRoute.provider.id,
        "x-modelpatrol-model": catalogRoute.model.id,
        "x-modelpatrol-level": catalogRoute.level,
        "x-modelpatrol-warnings":
          warnings.map((w) => `${w.window}:${w.reason}`).join(",") || "",
      });
      if (streamed) {
        res.end(upstream.body);
        return;
      }
      const parsed = parseJson(upstream.body);
      res.end(
        JSON.stringify(
          rewriteResponseModel(
            parsed ?? { raw: upstream.body },
            inboundModel ?? catalogRoute.model.id,
          ),
        ),
      );
      return;
    }

    const intent = extractIntent({
      config: ctx.config,
      headers: req.headers,
      queryIntent: url.searchParams.get("intent"),
      model: inboundModel,
    });
    const route = resolveRoute(ctx.config, intent);
    const translated = translateBody(body, protocol, route.plan.protocol, route.model);
    const upstream = await forwardJson({
      plan: route.plan,
      path: translated.path,
      body: translated.body,
      protocol: route.plan.protocol,
      stream: streamed,
      env: ctx.env,
      home: ctx.home,
      fetchImpl: ctx.fetchImpl,
    });
    const usage = streamed
      ? extractSseUsage(upstream.body)
      : extractUsage(parseJson(upstream.body));
    const estimatedPrompt =
      usage.promptTokens ||
      estimateTokensFromText(JSON.stringify(body.messages ?? body.input ?? ""));
    const estimatedCompletion =
      usage.completionTokens ||
      estimateTokensFromText(extractOutputText(upstream.body));
    record(ctx, {
      intent,
      plan: route.plan.id,
      model: route.model,
      provider: null,
      level: null,
      protocol: route.plan.protocol,
      harness,
      promptTokens: estimatedPrompt,
      completionTokens: estimatedCompletion,
      status: upstream.status,
      latencyMs: ctx.now().getTime() - started.getTime(),
      streamed,
      error: upstream.status >= 400 ? truncate(upstream.body) : null,
    });
    writeCors(res);
    res.writeHead(upstream.status, {
      "content-type": streamed
        ? (upstream.headers.get("content-type") ?? "text/event-stream")
        : "application/json",
      "x-modelpatrol-intent": intent,
      "x-modelpatrol-plan": route.plan.id,
      "x-modelpatrol-model": route.model,
      "x-modelpatrol-warnings":
        warnings.map((w) => `${w.window}:${w.reason}`).join(",") || "",
    });
    if (streamed) {
      res.end(upstream.body);
      return;
    }
    const parsed = parseJson(upstream.body);
    res.end(
      JSON.stringify(
        rewriteResponseModel(parsed ?? { raw: upstream.body }, inboundModel ?? intent),
      ),
    );
  } catch (err) {
    const mapped = toHttpError(err);
    record(ctx, {
      intent: providerModelLevel ? providerModelLevel.model : (inboundModel ?? "build"),
      plan: "none",
      model: inboundModel ?? providerModelLevel?.model ?? "build",
      provider: providerModelLevel?.provider ?? null,
      level: providerModelLevel?.level ?? null,
      protocol: protocol === "responses" ? "openai" : protocol,
      harness,
      promptTokens: 0,
      completionTokens: 0,
      status: mapped.status,
      latencyMs: ctx.now().getTime() - started.getTime(),
      streamed,
      error: mapped.message,
    });
    json(res, mapped.status, {
      error: { message: mapped.message, type: mapped.code, param: INTENT_HEADER },
    });
  }
}

export function statusPayload(ctx: ProxyContext): Record<string, unknown> {
  return {
    ok: true,
    service: "modelpatrol",
    host: ctx.config.host,
    port: ctx.config.port,
    defaultIntent: ctx.config.defaultIntent,
    intents: Object.keys(ctx.config.intents),
    plans: Object.keys(ctx.config.plans),
  };
}

export function usagePayload(ctx: ProxyContext): Record<string, unknown> {
  return {
    generatedAt: ctx.now().toISOString(),
    windows: snapshotAll(readEvents(ctx.home), ctx.now()),
  };
}

function modelsPayload(config: Config): Record<string, unknown> {
  const data = Object.keys(config.intents).map((id) => ({
    id,
    object: "model",
    owned_by: "modelpatrol",
  }));
  return { object: "list", data };
}

function record(
  ctx: ProxyContext,
  input: {
    intent: string;
    plan: string;
    model: string;
    provider: string | null;
    level: string | null;
    protocol: LedgerEvent["protocol"];
    harness: string | null;
    promptTokens: number;
    completionTokens: number;
    status: number;
    latencyMs: number;
    streamed: boolean;
    error: string | null;
  },
): void {
  const event: LedgerEvent = {
    id: newId("evt"),
    ts: ctx.now().toISOString(),
    intent: input.intent,
    plan: input.plan,
    model: input.model,
    provider: input.provider,
    level: input.level,
    protocol: input.protocol,
    harness: input.harness,
    promptTokens: input.promptTokens,
    completionTokens: input.completionTokens,
    totalTokens: input.promptTokens + input.completionTokens,
    costUsd: estimateCostUsd(
      ctx.config,
      input.model,
      input.promptTokens,
      input.completionTokens,
    ),
    status: input.status,
    latencyMs: input.latencyMs,
    streamed: input.streamed,
    error: input.error,
  };
  appendEvent(ctx.home, event);
}

function tokenOk(req: IncomingMessage, env: NodeJS.ProcessEnv): boolean {
  const expected = env.MODELPATROL_TOKEN;
  if (!expected) {
    return false;
  }
  const auth = req.headers.authorization ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const header = String(req.headers["x-api-key"] ?? "");
  return bearer === expected || header === expected;
}

function writeCors(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  writeCors(res);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(`${JSON.stringify(payload)}\n`);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractOutputText(body: string): string {
  const parsed = parseJson(body);
  const record = asRecord(parsed);
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const first = asRecord(choices[0]);
  const message = asRecord(first.message);
  if (typeof message.content === "string") {
    return message.content;
  }
  if (typeof record.content === "string") {
    return record.content;
  }
  return body.slice(0, 200);
}

function truncate(text: string): string {
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

function toHttpError(err: unknown): { status: number; code: string; message: string } {
  if (err instanceof ModelpatrolError) {
    const status =
      err.code === "WINDOW_EXCEEDED"
        ? 429
        : err.code === "INTENT_UNKNOWN" ||
            err.code === "PLAN_UNKNOWN" ||
            err.code === "PROVIDER_UNKNOWN" ||
            err.code === "MODEL_UNKNOWN"
          ? 400
          : err.code === "PLAN_UNAUTHENTICATED"
            ? 401
            : 502;
    return { status, code: err.code, message: err.message };
  }
  return {
    status: 500,
    code: "INTERNAL",
    message: err instanceof Error ? err.message : "internal error",
  };
}
