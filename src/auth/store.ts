import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { ModelpatrolError } from "../core/errors.js";
import { credentialPath } from "../infra/paths.js";

export interface StoredCredential {
  access: string;
  refresh: string;
  expires: number;
  tokenType?: string;
}

export type CredentialInspect =
  | { status: "missing" }
  | { status: "valid"; cred: StoredCredential }
  | { status: "invalid" };

function isStoredCredential(value: unknown): value is StoredCredential {
  if (!value || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.access === "string" &&
    typeof rec.refresh === "string" &&
    typeof rec.expires === "number"
  );
}

export function inspectCredential(home: string, planId: string): CredentialInspect {
  const path = credentialPath(home, planId);
  try {
    const raw = readFileSync(path, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (isStoredCredential(parsed)) {
      return {
        status: "valid",
        cred: {
          access: parsed.access,
          refresh: parsed.refresh,
          expires: parsed.expires,
          tokenType: parsed.tokenType,
        },
      };
    }
    return { status: "invalid" };
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "ENOENT") {
      return { status: "missing" };
    }
    return { status: "invalid" };
  }
}

export function readCredential(home: string, planId: string): StoredCredential | null {
  const inspected = inspectCredential(home, planId);
  return inspected.status === "valid" ? inspected.cred : null;
}

export function writeCredential(
  home: string,
  planId: string,
  cred: StoredCredential,
): void {
  const path = credentialPath(home, planId);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const data = JSON.stringify(
    {
      access: cred.access,
      refresh: cred.refresh,
      expires: cred.expires,
      tokenType: cred.tokenType,
    },
    null,
    2,
  );
  writeFileSync(path, `${data}\n`, { mode: 0o600 });
}

export function deleteCredential(home: string, planId: string): void {
  const path = credentialPath(home, planId);
  try {
    rmSync(path);
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    if (e.code !== "ENOENT") {
      throw new ModelpatrolError(
        "INTERNAL",
        `failed to delete credential: ${e.message || String(err)}`,
      );
    }
  }
}
