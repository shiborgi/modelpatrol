import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ZodError } from "zod";

import { deleteCredential, inspectCredential, writeCredential } from "../auth/store.js";
import { pollDeviceCodeToken, requestDeviceCode } from "../auth/xai-oauth.js";
import { CATALOG, resolveCatalogRoute } from "../catalog/catalog.js";
import { loadConfig, writeDefaultConfig } from "../config/load.js";
import { ModelpatrolError } from "../core/errors.js";
import type { CliResult } from "../core/model.js";
import { resolveHome } from "../infra/paths.js";
import { detachStart, runningPid, stopProcess, writePid } from "../infra/process.js";
import { readEvents } from "../ledger/store.js";
import { snapshotAll } from "../ledger/windows.js";
import { startProxy } from "../proxy/server.js";
import { planHasKey, resolveRoute } from "../routing/resolve.js";
import { flags, optionalHome } from "./args.js";

const VERSION = readPackageVersion();

function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "package.json"),
        "utf8",
      ),
    ) as { version: string };
    return pkg.version;
  } catch {
    return "0.0.0";
  }
}

const USAGE = `modelpatrol ${VERSION}

Usage:
  modelpatrol <command> [flags]

Commands:
  init                 Write the default config under --home
  doctor               Check config, plan keys, and process state
  catalog              List providers, models, and their levels
  connect --plan ID    Connect a plan (supergrok) via device authorization
  disconnect --plan ID Remove stored credential for a plan
  start                Start the local proxy
  stop                 Stop a detached proxy
  status               Show process and listen address
  usage                Print rolling 5h / 7d / 30d windows
  resolve              Show targets for --intent or --provider/--model
  env                  Print harness exports for --intent or --provider/--model

Options:
  --home DIR           State directory (default: ~/.modelpatrol)
  --host HOST          Bind address for start
  --port PORT          Bind port for start
  --detach             Start in the background
  --plan ID            Plan id for connect/disconnect
  --no-browser         Do not open browser during connect
  --intent ID          Intent id for resolve/env
  --provider ID        Provider id for resolve/env
  --model ID           Model id for resolve/env
  --level ID           Level (default|high|max) for resolve/env
  --help, -h           Show this help
  --version, -v        Print the version
`;

export interface CliDeps {
  fetchImpl?: typeof fetch;
  openBrowser?: (url: string) => void;
  writeStdout?: (text: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

export function defaultOpenBrowser(url: string): void {
  const platform = process.platform;
  let cmd: string;
  let args: string[];
  if (platform === "darwin") {
    cmd = "open";
    args = [url];
  } else if (platform === "win32") {
    cmd = "cmd";
    args = ["/c", "start", "", url];
  } else {
    cmd = "xdg-open";
    args = [url];
  }
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    return;
  }
}

export async function runCli(argv: string[], deps: CliDeps = {}): Promise<CliResult> {
  try {
    return await dispatch(argv.slice(2), deps);
  } catch (err) {
    if (err instanceof ModelpatrolError) {
      return fail(err.exitCode, err.code, err.message);
    }
    if (err instanceof ZodError) {
      return fail(2, "USAGE", err.issues.map((i) => i.message).join("; "));
    }
    return fail(1, "INTERNAL", err instanceof Error ? err.message : "internal error");
  }
}

async function dispatch(args: string[], deps: CliDeps): Promise<CliResult> {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    return ok(USAGE);
  }
  if (args.includes("--version") || args.includes("-v")) {
    return ok(`${VERSION}\n`);
  }
  const [command, ...rest] = args;
  if (!command) {
    return ok(USAGE);
  }
  const opts = flags(rest);
  switch (command) {
    case "init":
      return runInit(opts);
    case "doctor":
      return runDoctor(opts);
    case "connect":
      return runConnect(opts, deps);
    case "disconnect":
      return runDisconnect(opts);
    case "start":
      return runStart(opts);
    case "stop":
      return runStop(opts);
    case "status":
      return runStatus(opts);
    case "usage":
      return runUsage(opts);
    case "catalog":
      return runCatalog();
    case "resolve":
      return runResolve(opts);
    case "env":
      return runEnv(opts);
    default:
      throw new ModelpatrolError("USAGE", `unknown command: ${command}`);
  }
}

function runInit(opts: Map<string, string>): CliResult {
  const result = writeDefaultConfig(optionalHome(opts));
  return okJson({
    ok: true,
    created: result.created,
    home: result.home,
    path: result.path,
  });
}

function runDoctor(opts: Map<string, string>): CliResult {
  const home = resolveHome(optionalHome(opts));
  const loaded = loadConfig(home);
  const errors: Array<{ plan: string; code: string }> = [];
  const plans = Object.values(loaded.config.plans).map((plan) => {
    const hasEnv = planHasKey(plan, process.env);
    let authSource: "env" | "oauth" | "missing" = "missing";
    let authenticated = false;
    let error: string | undefined;

    if (plan.id === "supergrok") {
      const inspected = inspectCredential(home, "supergrok");
      if (inspected.status === "invalid") {
        error = "CONFIG_INVALID";
        authSource = "missing";
        authenticated = false;
        errors.push({ plan: plan.id, code: "CONFIG_INVALID" });
      } else if (hasEnv) {
        authSource = "env";
        authenticated = true;
      } else if (inspected.status === "valid") {
        authSource = "oauth";
        authenticated = true;
      }
    } else {
      authenticated = hasEnv;
    }

    return {
      id: plan.id,
      authenticated,
      authEnv: plan.authEnv,
      authSource: plan.id === "supergrok" ? authSource : undefined,
      ...(error ? { error } : {}),
    };
  });
  const missing = plans.filter((plan) => !plan.authenticated).map((plan) => plan.id);
  const pid = runningPid(home);
  return okJson({
    ok: true,
    home,
    configPath: loaded.path,
    running: pid !== null,
    pid,
    plans,
    missingKeys: missing,
    errors,
    intents: Object.keys(loaded.config.intents),
  });
}

async function runStart(opts: Map<string, string>): Promise<CliResult> {
  const home = resolveHome(optionalHome(opts));
  mkdirSync(home, { recursive: true });
  const existing = runningPid(home);
  if (existing !== null && existing !== process.pid) {
    throw new ModelpatrolError(
      "PROXY_ALREADY_RUNNING",
      `modelpatrol already running as pid ${existing}`,
    );
  }
  const loaded = loadConfig(home);
  const host = opts.get("--host") ?? loaded.config.host;
  const portRaw = opts.get("--port");
  const port = portRaw ? Number(portRaw) : loaded.config.port;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new ModelpatrolError("USAGE", "invalid --port");
  }
  if (opts.get("--detach") === "true") {
    const bin = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "bin",
      "modelpatrol.js",
    );
    const childArgv = [
      bin,
      "start",
      "--home",
      home,
      "--host",
      host,
      "--port",
      String(port),
    ];
    const pid = detachStart(childArgv);
    return okJson({ ok: true, detached: true, pid, host, port, home });
  }
  const handle = await startProxy({ home, config: loaded.config, host, port });
  writePid(home, process.pid);
  const payload = {
    ok: true,
    detached: false,
    pid: process.pid,
    host: handle.host,
    port: handle.port,
    home,
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  await new Promise<void>((resolve) => {
    const stop = () => {
      void handle.close().finally(() => resolve());
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
  return { exitCode: 0, stdout: "", stderr: "" };
}

function runStop(opts: Map<string, string>): CliResult {
  const home = resolveHome(optionalHome(opts));
  const result = stopProcess(home);
  return okJson({ ok: true, pid: result.pid, home });
}

function runStatus(opts: Map<string, string>): CliResult {
  const home = resolveHome(optionalHome(opts));
  const loaded = loadConfig(home);
  const pid = runningPid(home);
  return okJson({
    ok: true,
    running: pid !== null,
    pid,
    host: loaded.config.host,
    port: loaded.config.port,
    home,
  });
}

function runUsage(opts: Map<string, string>): CliResult {
  const home = resolveHome(optionalHome(opts));
  return okJson({
    generatedAt: new Date().toISOString(),
    home,
    windows: snapshotAll(readEvents(home)),
  });
}

function runCatalog(): CliResult {
  const providers = Object.values(CATALOG).map((provider) => ({
    id: provider.id,
    label: provider.label,
    baseUrl: provider.baseUrl,
    models: provider.models.map((model) => ({
      id: model.id,
      levels: model.levels.map((level) => ({
        id: level.id,
        reasoning: level.reasoning,
      })),
    })),
  }));
  return okJson({ providers });
}

function catalogResolve(
  opts: Map<string, string>,
): { kind: "catalog"; baseOutput: Record<string, unknown> } | null {
  const provider = opts.get("--provider");
  const model = opts.get("--model");
  if (!provider && !model) {
    return null;
  }
  if (!provider || !model) {
    throw new ModelpatrolError("USAGE", "--provider and --model must be used together");
  }
  const level = opts.get("--level");
  const route = resolveCatalogRoute(CATALOG, provider, model, level ?? null);
  return {
    kind: "catalog",
    baseOutput: {
      provider: route.provider.id,
      model: route.model.id,
      level: route.level,
      reasoning: route.reasoning,
      baseUrl: route.plan.baseUrl,
    },
  };
}

function runResolve(opts: Map<string, string>): CliResult {
  const catalog = catalogResolve(opts);
  if (catalog) {
    return okJson(catalog.baseOutput);
  }
  const intent = opts.get("--intent");
  if (!intent) {
    throw new ModelpatrolError(
      "USAGE",
      "missing --intent (or --provider with --model)",
    );
  }
  const loaded = loadConfig(optionalHome(opts));
  const route = resolveRoute(loaded.config, intent);
  return okJson({
    intent: route.intent,
    plan: route.plan.id,
    model: route.model,
    protocol: route.plan.protocol,
    baseUrl: route.plan.baseUrl,
    fallbacks: route.fallbacks.map((item) => ({
      plan: item.plan.id,
      model: item.model,
    })),
  });
}

function runEnv(opts: Map<string, string>): CliResult {
  const loaded = loadConfig(optionalHome(opts));
  const base = `http://${loaded.config.host}:${loaded.config.port}`;
  const provider = opts.get("--provider");
  const model = opts.get("--model");
  if (provider || model) {
    const catalog = catalogResolve(opts);
    if (!catalog) {
      throw new ModelpatrolError(
        "USAGE",
        "--provider and --model must be used together",
      );
    }
    const lines = [
      `export OPENAI_BASE_URL=${base}/v1`,
      `export ANTHROPIC_BASE_URL=${base}`,
      "export OPENAI_API_KEY=modelpatrol",
      "export ANTHROPIC_API_KEY=modelpatrol",
      `export MODELPATROL_PROVIDER=${catalog.baseOutput.provider}`,
      `export MODELPATROL_MODEL=${catalog.baseOutput.model}`,
      `export MODELPATROL_LEVEL=${catalog.baseOutput.level}`,
    ];
    return ok(`${lines.join("\n")}\n`);
  }
  const intent = opts.get("--intent");
  if (!intent) {
    throw new ModelpatrolError(
      "USAGE",
      "missing --intent (or --provider with --model)",
    );
  }
  const route = resolveRoute(loaded.config, intent);
  const lines = [
    `export OPENAI_BASE_URL=${base}/v1`,
    `export ANTHROPIC_BASE_URL=${base}`,
    "export OPENAI_API_KEY=modelpatrol",
    "export ANTHROPIC_API_KEY=modelpatrol",
    `export MODELPATROL_INTENT=${route.intent}`,
  ];
  return ok(`${lines.join("\n")}\n`);
}

async function runConnect(
  opts: Map<string, string>,
  deps: CliDeps,
): Promise<CliResult> {
  const plan = opts.get("--plan");
  if (!plan) {
    throw new ModelpatrolError("USAGE", "missing --plan");
  }
  if (plan !== "supergrok") {
    throw new ModelpatrolError("USAGE", "connect only supported for supergrok");
  }
  const home = resolveHome(optionalHome(opts));
  const noBrowser = opts.get("--no-browser") === "true";
  const writeStdout =
    deps.writeStdout ?? ((text: string) => process.stdout.write(text));
  const openBrowser = deps.openBrowser ?? defaultOpenBrowser;

  const device = await requestDeviceCode({ fetchImpl: deps.fetchImpl });
  const first = {
    plan,
    verificationUri: device.verification_uri,
    userCode: device.user_code,
  };
  writeStdout(`${JSON.stringify(first)}\n`);

  if (!noBrowser) {
    try {
      openBrowser(device.verification_uri_complete || device.verification_uri);
    } catch {
      void 0;
    }
  }

  const token = await pollDeviceCodeToken(device, {
    fetchImpl: deps.fetchImpl,
    sleep: deps.sleep,
  });
  const expires = Date.now() + (token.expires_in ?? 3600) * 1000;
  writeCredential(home, plan, {
    access: token.access_token,
    refresh: token.refresh_token || "",
    expires,
    tokenType: token.token_type,
  });
  return okJson({ ok: true, plan, expires });
}

function runDisconnect(opts: Map<string, string>): CliResult {
  const plan = opts.get("--plan");
  if (!plan) {
    throw new ModelpatrolError("USAGE", "missing --plan");
  }
  if (plan !== "supergrok") {
    throw new ModelpatrolError("USAGE", "disconnect only supported for supergrok");
  }
  const home = resolveHome(optionalHome(opts));
  deleteCredential(home, plan);
  return okJson({ ok: true, plan });
}

function ok(stdout: string): CliResult {
  return { exitCode: 0, stdout, stderr: "" };
}

function okJson(payload: unknown): CliResult {
  return ok(`${JSON.stringify(payload, null, 2)}\n`);
}

function fail(exitCode: number, code: string, message: string): CliResult {
  return {
    exitCode,
    stdout: "",
    stderr: `${JSON.stringify({ error: code, message })}\n`,
  };
}
