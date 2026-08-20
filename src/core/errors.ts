export type ErrorCode =
  | "USAGE"
  | "CONFIG_INVALID"
  | "CONFIG_MISSING"
  | "INTENT_UNKNOWN"
  | "PLAN_UNKNOWN"
  | "PLAN_UNAUTHENTICATED"
  | "WINDOW_EXCEEDED"
  | "UPSTREAM_FAILED"
  | "PROXY_NOT_RUNNING"
  | "PROXY_ALREADY_RUNNING"
  | "INTERNAL";

const EXIT_CODES: Record<ErrorCode, number> = {
  USAGE: 2,
  CONFIG_INVALID: 1,
  CONFIG_MISSING: 1,
  INTENT_UNKNOWN: 1,
  PLAN_UNKNOWN: 1,
  PLAN_UNAUTHENTICATED: 1,
  WINDOW_EXCEEDED: 1,
  UPSTREAM_FAILED: 1,
  PROXY_NOT_RUNNING: 1,
  PROXY_ALREADY_RUNNING: 1,
  INTERNAL: 1,
};

export class ModelpatrolError extends Error {
  readonly code: ErrorCode;
  readonly exitCode: number;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "ModelpatrolError";
    this.code = code;
    this.exitCode = EXIT_CODES[code];
  }
}
