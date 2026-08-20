import type { Protocol } from "../core/constants.js";
import { ModelpatrolError } from "../core/errors.js";
import type { PlanDefinition } from "../core/model.js";
import { resolvePlanKey } from "../routing/resolve.js";
import type { JsonRecord } from "./translate.js";

export interface UpstreamResult {
  status: number;
  headers: Headers;
  body: string;
  streamed: boolean;
}

export async function forwardJson(input: {
  plan: PlanDefinition;
  path: string;
  body: JsonRecord;
  protocol: Protocol;
  stream: boolean;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<UpstreamResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const key = resolvePlanKey(input.plan, input.env ?? process.env);
  const url = joinUrl(input.plan.baseUrl, input.path);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...input.plan.extraHeaders,
  };
  if (input.protocol === "anthropic") {
    headers["x-api-key"] = key;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers.authorization = `Bearer ${key}`;
  }
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(input.body),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "upstream fetch failed";
    throw new ModelpatrolError("UPSTREAM_FAILED", message);
  }
  const body = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body,
    streamed: input.stream,
  };
}

export function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  if (base.endsWith("/v1") && suffix.startsWith("/v1/")) {
    return `${base}${suffix.slice(3)}`;
  }
  if (base.endsWith("/v4") && suffix.startsWith("/v1/")) {
    return `${base}${suffix.slice(3)}`;
  }
  return `${base}${suffix}`;
}
