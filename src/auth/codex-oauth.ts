import { ModelpatrolError } from "../core/errors.js";

const DEVICE_URL = "https://auth.openai.com/api/accounts/deviceauth/usercode";
const POLL_URL = "https://auth.openai.com/api/accounts/deviceauth/token";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const VERIFY_URL = "https://auth.openai.com/codex/device";
const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_EXPIRES_MS = 5 * 60 * 1000;

export interface CodexOauthOptions {
  deviceUrl?: string;
  pollUrl?: string;
  tokenUrl?: string;
  verificationUrl?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  clientId?: string;
}

export interface CodexDeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in?: number;
  interval?: number;
}

export interface CodexToken {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  code?: string;
  authorization_code?: string;
}

function headers(): Record<string, string> {
  return { "content-type": "application/json", accept: "application/json" };
}

async function sleepDefault(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function jsonResponse(res: Response): Promise<Record<string, unknown>> {
  try {
    const value = await res.json();
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function requestDeviceCode(
  options: CodexOauthOptions = {},
): Promise<CodexDeviceCode> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const res = await fetchImpl(options.deviceUrl ?? DEVICE_URL, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ client_id: options.clientId ?? "codex" }),
  });
  const value = await jsonResponse(res);
  if (!res.ok) {
    throw new ModelpatrolError(
      "UPSTREAM_FAILED",
      `Codex device request failed (${res.status})`,
    );
  }
  const device: CodexDeviceCode = {
    device_code: String(value.device_code ?? value.deviceCode ?? ""),
    user_code: String(value.user_code ?? value.userCode ?? ""),
    verification_uri: String(
      value.verification_uri ?? options.verificationUrl ?? VERIFY_URL,
    ),
    verification_uri_complete:
      typeof value.verification_uri_complete === "string"
        ? value.verification_uri_complete
        : undefined,
    expires_in: typeof value.expires_in === "number" ? value.expires_in : undefined,
    interval: typeof value.interval === "number" ? value.interval : undefined,
  };
  if (!device.device_code || !device.user_code) {
    throw new ModelpatrolError(
      "UPSTREAM_FAILED",
      "Codex device response is missing required fields",
    );
  }
  return device;
}

export async function pollDeviceCodeToken(
  device: CodexDeviceCode,
  options: CodexOauthOptions = {},
): Promise<CodexToken> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? sleepDefault;
  const now = options.now ?? (() => Date.now());
  const deadline =
    now() + (device.expires_in ? device.expires_in * 1000 : DEFAULT_EXPIRES_MS);
  const interval = (device.interval ?? DEFAULT_INTERVAL_MS / 1000) * 1000;
  while (now() < deadline) {
    const res = await fetchImpl(options.pollUrl ?? POLL_URL, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        device_code: device.device_code,
        client_id: options.clientId ?? "codex",
      }),
    });
    const value = await jsonResponse(res);
    if (res.ok && (value.access_token || value.code || value.authorization_code)) {
      return value as unknown as CodexToken;
    }
    const error = String(value.error ?? "");
    if (error === "authorization_pending") {
      await sleep(interval);
      continue;
    }
    if (error === "slow_down") {
      await sleep(interval + 5000);
      continue;
    }
    if (error === "access_denied" || error === "authorization_denied") {
      throw new ModelpatrolError(
        "OAUTH_DENIED",
        "Codex device authorization was denied",
      );
    }
    if (error === "expired_token") {
      throw new ModelpatrolError("OAUTH_EXPIRED", "Codex device code expired");
    }
    throw new ModelpatrolError(
      "UPSTREAM_FAILED",
      `Codex device polling failed (${res.status})`,
    );
  }
  throw new ModelpatrolError("OAUTH_TIMEOUT", "Codex device authorization timed out");
}

export async function exchangeToken(
  code: string,
  options: CodexOauthOptions = {},
): Promise<CodexToken> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const res = await fetchImpl(options.tokenUrl ?? TOKEN_URL, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ code, client_id: options.clientId ?? "codex" }),
  });
  const value = await jsonResponse(res);
  if (!res.ok || !value.access_token) {
    throw new ModelpatrolError(
      "UPSTREAM_FAILED",
      `Codex token exchange failed (${res.status})`,
    );
  }
  return value as unknown as CodexToken;
}

export async function refreshAccessToken(
  refreshToken: string,
  options: CodexOauthOptions = {},
): Promise<CodexToken> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const res = await fetchImpl(options.tokenUrl ?? TOKEN_URL, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: options.clientId ?? "codex",
    }),
  });
  const value = await jsonResponse(res);
  if (!res.ok || !value.access_token) {
    throw new ModelpatrolError(
      "UPSTREAM_FAILED",
      `Codex token refresh failed (${res.status})`,
    );
  }
  return value as unknown as CodexToken;
}
