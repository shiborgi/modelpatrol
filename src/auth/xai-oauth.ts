import { ModelpatrolError } from "../core/errors.js";

const DEFAULT_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const DEFAULT_DEVICE_URL = "https://auth.x.ai/oauth2/device/code";
const DEFAULT_TOKEN_URL = "https://auth.x.ai/oauth2/token";
const DEFAULT_SCOPE = "openid profile email offline_access grok-cli:access api:access";

const ACCESS_TOKEN_REFRESH_SKEW_MS = 120_000;
const DEVICE_CODE_DEFAULT_INTERVAL_MS = 5000;
const DEVICE_CODE_MIN_INTERVAL_MS = 1000;
const DEVICE_CODE_SLOW_DOWN_INCREMENT_MS = 5000;
const DEVICE_CODE_DEFAULT_EXPIRES_MS = 5 * 60 * 1000;
const OAUTH_POLLING_SAFETY_MARGIN_MS = 2000;

export function accessTokenIsExpiring(
  token: string | undefined,
  skewMs: number = ACCESS_TOKEN_REFRESH_SKEW_MS,
): boolean {
  if (!token || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length < 2) return false;
  try {
    let payload = (parts[1] || "").replace(/-/g, "+").replace(/_/g, "/");
    while (payload.length % 4 !== 0) payload += "=";
    const claims = JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as {
      exp?: number;
    };
    if (typeof claims.exp !== "number") return false;
    return claims.exp * 1000 <= Date.now() + Math.max(0, skewMs);
  } catch {
    return false;
  }
}

export interface XaiOauthOptions {
  clientId?: string;
  deviceUrl?: string;
  tokenUrl?: string;
  scope?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in?: number;
  interval?: number;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

function getEnvOrDefault(key: string, def: string): string {
  return process.env[key] ?? def;
}

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
    "User-Agent": "modelpatrol",
  };
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function positiveSecondsToMs(value: unknown, defaultMs: number): number {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : defaultMs;
}

export async function requestDeviceCode(
  options: XaiOauthOptions = {},
): Promise<DeviceCodeResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const clientId =
    options.clientId ?? getEnvOrDefault("MODELPATROL_XAI_CLIENT_ID", DEFAULT_CLIENT_ID);
  const deviceUrl =
    options.deviceUrl ??
    getEnvOrDefault("MODELPATROL_XAI_DEVICE_URL", DEFAULT_DEVICE_URL);
  const scope =
    options.scope ?? getEnvOrDefault("MODELPATROL_XAI_SCOPE", DEFAULT_SCOPE);

  const body = new URLSearchParams({
    client_id: clientId,
    scope,
    referrer: "modelpatrol",
  });

  const res = await fetchImpl(deviceUrl, {
    method: "POST",
    headers: authHeaders(),
    body: body.toString(),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ModelpatrolError(
      "UPSTREAM_FAILED",
      `xAI device code request failed (${res.status})${detail ? `: ${detail}` : ""}`,
    );
  }

  const json = (await res.json()) as DeviceCodeResponse;
  if (!json.device_code || !json.user_code || !json.verification_uri) {
    throw new ModelpatrolError(
      "UPSTREAM_FAILED",
      "xAI device code response is missing required fields",
    );
  }
  return json;
}

export async function pollDeviceCodeToken(
  device: DeviceCodeResponse,
  options: XaiOauthOptions = {},
): Promise<TokenResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? (() => Date.now());
  const tokenUrl =
    options.tokenUrl ?? getEnvOrDefault("MODELPATROL_XAI_TOKEN_URL", DEFAULT_TOKEN_URL);
  const clientId =
    options.clientId ?? getEnvOrDefault("MODELPATROL_XAI_CLIENT_ID", DEFAULT_CLIENT_ID);

  const expiresInMs = positiveSecondsToMs(
    device.expires_in,
    DEVICE_CODE_DEFAULT_EXPIRES_MS,
  );
  const deadline = now() + expiresInMs;
  let intervalMs = Math.max(
    positiveSecondsToMs(device.interval, DEVICE_CODE_DEFAULT_INTERVAL_MS),
    DEVICE_CODE_MIN_INTERVAL_MS,
  );

  while (now() < deadline) {
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: clientId,
      device_code: device.device_code,
    });

    const res = await fetchImpl(tokenUrl, {
      method: "POST",
      headers: authHeaders(),
      body: body.toString(),
    });

    if (res.ok) {
      const token = (await res.json()) as TokenResponse;
      if (!token.access_token) {
        throw new ModelpatrolError(
          "UPSTREAM_FAILED",
          "xAI token response missing access_token",
        );
      }
      return token;
    }

    let bodyJson: { error?: string; error_description?: string } = {};
    try {
      const parsed: unknown = await res.json();
      if (parsed && typeof parsed === "object") {
        bodyJson = parsed as { error?: string; error_description?: string };
      }
    } catch {
      bodyJson = {};
    }

    const err = bodyJson.error;
    if (err === "authorization_pending") {
      await sleep(
        Math.min(
          intervalMs + OAUTH_POLLING_SAFETY_MARGIN_MS,
          Math.max(0, deadline - now()),
        ),
      );
      continue;
    }
    if (err === "slow_down") {
      intervalMs += DEVICE_CODE_SLOW_DOWN_INCREMENT_MS;
      await sleep(
        Math.min(
          intervalMs + OAUTH_POLLING_SAFETY_MARGIN_MS,
          Math.max(0, deadline - now()),
        ),
      );
      continue;
    }
    if (err === "access_denied" || err === "authorization_denied") {
      throw new ModelpatrolError("OAUTH_DENIED", "xAI device authorization was denied");
    }
    if (err === "expired_token") {
      throw new ModelpatrolError("OAUTH_EXPIRED", "xAI device code expired");
    }

    const detail = bodyJson.error_description ?? err ?? "";
    throw new ModelpatrolError(
      "UPSTREAM_FAILED",
      `xAI device token exchange failed (${res.status})${detail ? `: ${detail}` : ""}`,
    );
  }

  throw new ModelpatrolError("OAUTH_TIMEOUT", "xAI device authorization timed out");
}

export async function refreshAccessToken(
  refreshToken: string,
  options: XaiOauthOptions = {},
): Promise<TokenResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const tokenUrl =
    options.tokenUrl ?? getEnvOrDefault("MODELPATROL_XAI_TOKEN_URL", DEFAULT_TOKEN_URL);
  const clientId =
    options.clientId ?? getEnvOrDefault("MODELPATROL_XAI_CLIENT_ID", DEFAULT_CLIENT_ID);

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });

  const res = await fetchImpl(tokenUrl, {
    method: "POST",
    headers: authHeaders(),
    body: body.toString(),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ModelpatrolError(
      "UPSTREAM_FAILED",
      `xAI token refresh failed (${res.status})${detail ? `: ${detail}` : ""}`,
    );
  }

  const token = (await res.json()) as TokenResponse;
  if (!token.access_token) {
    throw new ModelpatrolError(
      "UPSTREAM_FAILED",
      "xAI refresh response missing access_token",
    );
  }
  return token;
}
