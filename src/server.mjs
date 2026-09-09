import { createServer } from "node:http";
import { randomUUID, timingSafeEqual, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { check, endpoints, validateConfig } from "./config.mjs";
import { readMetadata, route } from "./routing.mjs";
import { Store, summarize } from "./store.mjs";
import { costFor, extractUsage, StreamMeter } from "./usage.mjs";
import { centralUsage } from "./central-usage.mjs";
import { getHarness, harnessChatSse, invokeHarness } from "./harnesses.mjs";

function authorized(header, secret) {
  if (typeof header !== "string" || !secret) return false;
  const actual = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
// Dashboard and administration are unauthenticated by design, so they are
// only served to loopback and the Tailscale CGNAT range (100.64.0.0/10).
// Anything else (e.g. LAN) gets 403 here. Inference keeps its bearer key.
function trustedInterface(req) {
  const raw = req.socket?.remoteAddress ?? "";
  const addr = raw.startsWith("::ffff:") ? raw.slice("::ffff:".length) : raw;
  if (addr === "127.0.0.1" || addr === "::1") return true;
  const parts = addr.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p))) return false;
  const bytes = parts.map(Number);
  if (bytes.some((n) => n > 255)) return false;
  return bytes[0] === 100 && bytes[1] >= 64 && bytes[1] <= 127;
}
function json(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}
async function readBody(request, max) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    check(bytes <= max, "Request exceeds byte limit");
    chunks.push(chunk);
  }
  const body = JSON.parse(Buffer.concat(chunks));
  check(
    body && typeof body === "object" && !Array.isArray(body),
    "Expected JSON object",
  );
  return body;
}
async function limitedResponse(response, max) {
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    check(size <= max, "Response exceeds byte limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export function createGateway(
  input,
  { env = process.env, fetchImpl = fetch, store: suppliedStore } = {},
) {
  const config = validateConfig(input);
  check(
    env[config.gatewayKeyEnv]?.length >= 16,
    "Set a gateway secret of at least 16 characters",
  );
  const store = suppliedStore ?? new Store(config.dataDir);
  const cache = new Map();
  const circuit = new Map();
  let active = 0;
  let windowStart = Date.now();
  let requests = 0;
  const server = createServer(async (req, res) => {
    res.setHeader("x-content-type-options", "nosniff");
    const url = new URL(req.url, "http://localhost");
    try {
      if (req.method === "GET" && url.pathname === "/health") {
        await store.ready;
        return json(res, 200, {
          status: "ok",
          protocolVersion: "1.0",
          database: "sqlite",
        });
      }
      const admin = url.pathname.startsWith("/admin/");
      const dashboard = req.method === "GET" && ["/", "/dashboard.js", "/style.css"].includes(url.pathname);
      if ((admin || dashboard) && !trustedInterface(req))
        return json(res, 403, { error: { message: "Forbidden" } });
      if (dashboard) {
        const name =
          url.pathname === "/" ? "index.html" : url.pathname.slice(1);
        res.setHeader(
          "content-security-policy",
          "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'",
        );
        res.setHeader(
          "content-type",
          name.endsWith(".html")
            ? "text/html; charset=utf-8"
            : name.endsWith(".js")
              ? "text/javascript"
              : "text/css",
        );
        res.setHeader("cache-control", "no-store");
        return res.end(
          await readFile(new URL(`../public/${name}`, import.meta.url)),
        );
      }
      // Administration is intentionally unauthenticated (interface check
      // above); inference keeps its bearer key below.
      if (
        !admin &&
        !authorized(req.headers.authorization, env[config.gatewayKeyEnv])
      )
        return json(res, 401, { error: { message: "Unauthorized" } });
      if (admin) {
        const filters = Object.fromEntries(url.searchParams);
        if (req.method === "GET" && url.pathname === "/admin/requests")
          return json(res, 200, {
            data: await store.events(filters),
            limit: 10000,
          });
        if (req.method === "GET" && url.pathname === "/admin/metrics") {
          const events = await store.events({ ...filters, limit: 10000 });
          return json(res, 200, {
            groups: summarize(events, filters.groupBy ?? "model"),
            sampledRequests: events.length,
            maxRequests: 10000,
            monthlyCostUsd: await store.monthlyCost(),
            budgetUsd: config.budgetUsd ?? null,
          });
        }
        if (req.method === "GET" && url.pathname === "/admin/providers")
          return json(res, 200, {
            providers: Object.entries(config.providers).map(([id, p]) => ({
              id,
              plan: p.plan,
              configured: p.auth === "none" || Boolean(env[p.apiKeyEnv]),
              transport: p.transport.kind,
              usage: p.transport.kind === "harness" || Boolean(p.usageAdapter),
            })),
            models: config.models,
          });
        const usageMatch = url.pathname.match(/^\/admin\/providers\/([a-zA-Z0-9_.:-]+)\/usage$/);
        if (req.method === "GET" && usageMatch) {
          const provider = config.providers[usageMatch[1]];
          if (!provider)
            return json(res, 404, { error: { message: "Unknown provider" } });
          const usage = provider.transport.kind === "harness"
            ? await getHarness(provider.transport.adapter).getUsage(provider, env)
            : await centralUsage({ ...provider, id: usageMatch[1] }, env);
          return json(res, 200, usage);
        }
        if (req.method === "GET" && url.pathname === "/admin/export") {
          res.writeHead(200, {
            "content-type": "application/x-ndjson",
            "content-disposition": 'attachment; filename="modelpatrol.ndjson"',
          });
          return res.end(
            (await store.events({ ...filters, limit: 10000 }))
              .map((e) => JSON.stringify(e))
              .join("\n") + "\n",
          );
        }
        return json(res, 404, { error: { message: "Unknown admin endpoint" } });
      }
      if (req.method === "GET" && url.pathname === "/v1/models")
        return json(res, 200, {
          object: "list",
          data: [
            { id: "auto", object: "model", owned_by: "modelpatrol" },
            ...config.models.map((m) => ({
              id: m.id,
              object: "model",
              owned_by: m.provider,
            })),
          ],
        });
      const api = Object.keys(endpoints).find(
        (key) => endpoints[key] === url.pathname,
      );
      if (req.method !== "POST" || !api)
        return json(res, 404, { error: { message: "Unknown endpoint" } });
      if (Date.now() - windowStart >= 60000) {
        windowStart = Date.now();
        requests = 0;
      }
      if (
        ++requests > config.limits.requestsPerMinute ||
        active >= config.limits.maxConcurrent
      ) {
        res.setHeader("retry-after", "60");
        return json(res, 429, {
          error: { message: "Gateway capacity exceeded" },
        });
      }
      active++;
      try {
        await inference(req, res, api);
      } finally {
        active--;
      }
    } catch {
      if (!res.headersSent)
        json(res, 400, {
          error: { message: "Invalid request or unavailable gateway state" },
        });
      else res.destroy();
    }
  });
  server.requestTimeout = config.limits.timeoutMs;
  server.headersTimeout = Math.min(30000, config.limits.timeoutMs);

  async function inference(req, res, api) {
    const started = Date.now();
    const id = randomUUID();
    const event = {
      id,
      time: new Date().toISOString(),
      api,
      status: "error",
      usage: null,
      costUsd: null,
      metadata: {},
      attempts: [],
      ttftMs: null,
      cacheHit: false,
    };
    let reservation = 0;
    const abort = new AbortController();
    const disconnected = () => {
      if (!res.writableEnded) abort.abort();
    };
    res.on("close", disconnected);
    const timer = setTimeout(() => abort.abort(), config.limits.timeoutMs);
    try {
      const body = await readBody(req, config.limits.maxBodyBytes);
      check(
        body.stream === undefined || typeof body.stream === "boolean",
        "stream must be boolean",
      );
      check(
        body.model !== "auto" ||
          (!body.previous_response_id && !body.conversation),
        "Server-side conversations require an explicit pinned model",
      );
      event.metadata = readMetadata(req.headers);
      event.requestedModel = body.model;
      const selection = route(
        config,
        body,
        api,
        event.metadata,
        (m) => {
          const provider = config.providers[m.provider];
          return (
            (provider.auth === "none" || Boolean(env[provider.apiKeyEnv])) &&
            (circuit.get(m.id) ?? 0) <= Date.now()
          );
        },
      );
      event.reason = selection.reason;
      for (const [index, model] of selection.models.entries()) {
        const provider = config.providers[model.provider];
        event.model = model.id;
        event.provider = model.provider;
        event.plan = provider.plan.kind;
        const payload = { ...body, model: model.model };
        const outputField =
          api === "responses"
            ? "max_output_tokens"
            : api === "messages"
              ? "max_tokens"
              : body.max_completion_tokens
                ? "max_completion_tokens"
                : "max_tokens";
        payload[outputField] ??= model.maxOutputTokens;
        if (api === "chat" && body.stream)
          payload.stream_options = {
            ...body.stream_options,
            include_usage: true,
          };
        const cacheKey = createHash("sha256")
          .update(
            JSON.stringify([
              api,
              model.id,
              payload,
              event.metadata.project ?? "",
            ]),
          )
          .digest("hex");
        const cached = cache.get(cacheKey);
        if (
          config.cache.ttlMs &&
          !body.stream &&
          req.headers["x-patrol-cache"] === "true" &&
          cached?.expires > Date.now()
        ) {
          event.cacheHit = true;
          event.usage = {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          };
          event.costUsd = 0;
          event.status = "ok";
          res.setHeader("x-modelpatrol-request-id", id);
          res.setHeader("x-modelpatrol-model", model.id);
          return json(res, 200, cached.body);
        }
        if (config.budgetUsd !== undefined) {
          const p = model.pricing;
          check(
            p && provider.plan.kind === "metered",
            "Budgeted requests require metered pricing",
          );
          reservation =
            (selection.inputEstimate *
              Math.max(
                p.input,
                p.cacheRead ?? p.input,
                p.cacheWrite ?? p.input,
              ) +
              payload[outputField] * p.output) /
            1e6;
          if (
            (await store.monthlyCost()) +
              (await store.monthlyReservations()) +
              reservation >
            config.budgetUsd
          ) {
            reservation = 0;
            return json(res, 402, {
              error: { message: "Monthly budget exceeded" },
            });
          }
        }
        const headers = { "content-type": "application/json" };
        if (provider.auth === "anthropic") {
          headers["x-api-key"] = env[provider.apiKeyEnv];
          headers["anthropic-version"] = "2023-06-01";
        } else if (provider.auth === "bearer")
          headers.authorization = `Bearer ${env[provider.apiKeyEnv]}`;
        const attempt = {
          model: model.id,
          startedAt: new Date().toISOString(),
        };
        event.attempts.push(attempt);
        event.status = "pending";
        event.durationMs = Date.now() - started;
        if (reservation) event.budgetReservationUsd = reservation;
        // Persist before dispatch: process crashes must not erase in-flight spend reservations.
        await store.record(event);
        let upstream;
        if (provider.transport.kind === "harness") {
          if (payload.stream)
            check(api === "chat", "Buffered harness SSE currently requires Chat");
          const result = await invokeHarness(
            provider,
            api,
            { ...payload, stream: false },
            { env, signal: abort.signal },
          );
          if (payload.stream) {
            upstream = new Response(harnessChatSse(result), {
              status: 200,
              headers: { "content-type": "text/event-stream" },
            });
          } else
            upstream = new Response(JSON.stringify(result), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
        } else
          upstream = await fetchImpl(provider.baseUrl + endpoints[api], {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
            signal: abort.signal,
            redirect: "error",
          });
        attempt.status = upstream.status;
        // Only explicit rejection permits automatic fallback. Network ambiguity never retries a billable request.
        if (
          [429, 503].includes(upstream.status) &&
          body.model === "auto" &&
          index + 1 < selection.models.length
        ) {
          await upstream.body?.cancel();
          circuit.set(model.id, Date.now() + 30000);
          reservation = 0;
          delete event.budgetReservationUsd;
          await store.record(event);
          continue;
        }
        if (!upstream.ok) {
          await upstream.body?.cancel();
          return json(res, upstream.status, {
            error: { message: "Provider rejected request", requestId: id },
          });
        }
        res.setHeader("x-modelpatrol-request-id", id);
        res.setHeader("x-modelpatrol-model", model.id);
        res.setHeader("x-modelpatrol-route", selection.reason);
        if (body.stream) {
          check(
            upstream.headers.get("content-type")?.includes("text/event-stream"),
            "Expected SSE from provider",
          );
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            "x-accel-buffering": "no",
          });
          const meter = new StreamMeter(api);
          let bytes = 0;
          try {
            for await (const chunk of upstream.body) {
              bytes += chunk.length;
              check(
                bytes <= config.limits.maxResponseBytes,
                "Stream exceeds byte limit",
              );
              event.ttftMs ??= Date.now() - started;
              meter.push(chunk);
              if (!res.write(chunk))
                await once(res, "drain", { signal: abort.signal });
            }
            check(
              meter.complete && !meter.failed,
              "Provider stream incomplete",
            );
            event.status = "ok";
          } finally {
            event.usage = meter.usage;
            event.costUsd = costFor(event.usage, model, provider.plan);
          }
          res.end();
        } else {
          const raw = await limitedResponse(
            upstream,
            config.limits.maxResponseBytes,
          );
          const result = JSON.parse(raw);
          check(!result.error, "Provider returned an error");
          event.usage = extractUsage(result, api);
          event.costUsd = costFor(event.usage, model, provider.plan);
          event.status = "ok";
          if (config.cache.ttlMs && req.headers["x-patrol-cache"] === "true") {
            if (cache.size >= config.cache.maxEntries)
              cache.delete(cache.keys().next().value);
            // Avoid retaining large response bodies in the optional in-memory cache.
            if (raw.length <= 65536)
              cache.set(cacheKey, {
                body: result,
                expires: Date.now() + config.cache.ttlMs,
              });
          }
          json(res, 200, result);
        }
        return;
      }
    } catch (error) {
      event.status = abort.signal.aborted ? "aborted" : "error";
      if (!res.headersSent)
        json(res, error instanceof SyntaxError ? 400 : 502, {
          error: {
            message: "Request failed validation or provider execution",
            requestId: id,
          },
        });
      else res.destroy();
    } finally {
      clearTimeout(timer);
      abort.abort();
      res.off("close", disconnected);
      if (event.status === "pending") event.status = "error";
      event.durationMs = Date.now() - started;
      // Unknown billed usage retains its conservative reservation for budget enforcement.
      if (
        reservation &&
        event.costUsd === null &&
        event.attempts.some((x) => !x.status || x.status < 400)
      )
        event.budgetReservationUsd = reservation;
      else delete event.budgetReservationUsd;
      await store.record(event);
    }
  }
  return {
    server,
    store,
    config,
    ready: store.ready,
    close: async () => {
      server.closeAllConnections();
      if (server.listening)
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      if (!suppliedStore) await store.close();
    },
  };
}
