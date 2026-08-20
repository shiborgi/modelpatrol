import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { writeCredential } from "../src/auth/store.js";
import { runCli } from "../src/cli/index.js";
import { credentialPath } from "../src/infra/paths.js";

test("help and version print without a home", async () => {
  const help = await runCli(["node", "modelpatrol", "--help"]);
  assert.equal(help.exitCode, 0);
  assert.match(help.stdout, /modelpatrol /);
  const version = await runCli(["node", "modelpatrol", "--version"]);
  assert.equal(version.exitCode, 0);
  assert.match(version.stdout, /^\d+\.\d+\.\d+\n$/);
});

test("unknown command is USAGE", async () => {
  const result = await runCli(["node", "modelpatrol", "nope"]);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /USAGE/);
});

test("init, doctor, resolve and env work against a temp home", async () => {
  const home = mkdtempSync(join(tmpdir(), "modelpatrol-cli-"));
  const init = await runCli(["node", "modelpatrol", "init", "--home", home]);
  assert.equal(init.exitCode, 0);
  const created = JSON.parse(init.stdout) as { created: boolean };
  assert.equal(created.created, true);

  const doctor = await runCli(["node", "modelpatrol", "doctor", "--home", home]);
  assert.equal(doctor.exitCode, 0);
  const report = JSON.parse(doctor.stdout) as { ok: boolean; intents: string[] };
  assert.equal(report.ok, true);
  assert.ok(report.intents.includes("build"));

  const resolved = await runCli([
    "node",
    "modelpatrol",
    "resolve",
    "--home",
    home,
    "--intent",
    "build",
  ]);
  assert.equal(resolved.exitCode, 0);
  const route = JSON.parse(resolved.stdout) as { plan: string; model: string };
  assert.equal(route.plan, "codex");
  assert.equal(route.model, "gpt-5.3-codex");

  const env = await runCli([
    "node",
    "modelpatrol",
    "env",
    "--home",
    home,
    "--intent",
    "spec",
  ]);
  assert.equal(env.exitCode, 0);
  assert.match(env.stdout, /OPENAI_BASE_URL=/);
  assert.match(env.stdout, /MODELPATROL_INTENT=spec/);
});

test("connect and disconnect USAGE and successful disconnect", async () => {
  const help = await runCli(["node", "modelpatrol", "--help"]);
  assert.match(help.stdout, /connect --plan ID/);
  assert.match(help.stdout, /disconnect --plan ID/);
  assert.match(help.stdout, /--no-browser/);

  const noPlan = await runCli(["node", "modelpatrol", "connect"]);
  assert.equal(noPlan.exitCode, 2);
  assert.match(noPlan.stderr, /USAGE/);

  const badPlan = await runCli(["node", "modelpatrol", "connect", "--plan", "unknown"]);
  assert.equal(badPlan.exitCode, 2);
  assert.match(badPlan.stderr, /USAGE/);

  const badDisconnect = await runCli([
    "node",
    "modelpatrol",
    "disconnect",
    "--plan",
    "unknown",
  ]);
  assert.equal(badDisconnect.exitCode, 2);

  const home = mkdtempSync(join(tmpdir(), "modelpatrol-cli-"));
  await runCli(["node", "modelpatrol", "init", "--home", home]);
  writeCredential(home, "supergrok", {
    access: "tok",
    refresh: "ref",
    expires: Date.now() + 1000,
  });
  const gone = await runCli([
    "node",
    "modelpatrol",
    "disconnect",
    "--plan",
    "supergrok",
    "--home",
    home,
  ]);
  assert.equal(gone.exitCode, 0);
  assert.equal(JSON.parse(gone.stdout).ok, true);
  assert.equal(existsSync(credentialPath(home, "supergrok")), false);

  const missing = await runCli([
    "node",
    "modelpatrol",
    "disconnect",
    "--plan",
    "supergrok",
    "--home",
    home,
  ]);
  assert.equal(missing.exitCode, 0);
});

test("connect prints two JSON objects and respects --no-browser", async () => {
  const home = mkdtempSync(join(tmpdir(), "modelpatrol-cli-"));
  await runCli(["node", "modelpatrol", "init", "--home", home]);
  const opened: string[] = [];
  const firstLines: string[] = [];
  let calls = 0;
  const fetchImpl: typeof fetch = async (input) => {
    calls += 1;
    const url = String(input);
    if (url.includes("device")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          device_code: "dc",
          user_code: "WD-1",
          verification_uri: "https://auth.x.ai/device",
          verification_uri_complete: "https://auth.x.ai/device?code=WD-1",
          expires_in: 300,
        }),
        text: async () => "",
        headers: new Headers(),
      } as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "live-access",
        refresh_token: "live-refresh",
        expires_in: 3600,
        token_type: "Bearer",
      }),
      text: async () => "",
      headers: new Headers(),
    } as Response;
  };

  const withBrowser = await runCli(
    ["node", "modelpatrol", "connect", "--plan", "supergrok", "--home", home],
    {
      fetchImpl,
      openBrowser: (url) => {
        opened.push(url);
      },
      writeStdout: (text) => {
        firstLines.push(text);
      },
      sleep: async () => undefined,
    },
  );
  assert.equal(withBrowser.exitCode, 0);
  const preview = JSON.parse(firstLines[0] ?? "{}") as {
    plan: string;
    verificationUri: string;
    userCode: string;
  };
  assert.equal(preview.plan, "supergrok");
  assert.equal(preview.verificationUri, "https://auth.x.ai/device");
  assert.equal(preview.userCode, "WD-1");
  assert.equal(opened[0], "https://auth.x.ai/device?code=WD-1");
  const done = JSON.parse(withBrowser.stdout) as { ok: boolean; plan: string };
  assert.equal(done.ok, true);
  assert.equal(done.plan, "supergrok");
  const stored = readFileSync(credentialPath(home, "supergrok"), "utf8");
  assert.match(stored, /live-access/);
  const config = readFileSync(join(home, "config.json"), "utf8");
  assert.doesNotMatch(config, /live-access|live-refresh/);
  assert.equal(existsSync(join(home, "ledger.jsonl")), false);

  opened.length = 0;
  await runCli(
    [
      "node",
      "modelpatrol",
      "connect",
      "--plan",
      "supergrok",
      "--home",
      home,
      "--no-browser",
    ],
    {
      fetchImpl,
      openBrowser: (url) => {
        opened.push(url);
      },
      writeStdout: () => undefined,
      sleep: async () => undefined,
    },
  );
  assert.equal(opened.length, 0);
  assert.ok(calls >= 2);
});

test("doctor reports authSource and CONFIG_INVALID", async () => {
  const home = mkdtempSync(join(tmpdir(), "modelpatrol-cli-"));
  await runCli(["node", "modelpatrol", "init", "--home", home]);

  const missing = await runCli(["node", "modelpatrol", "doctor", "--home", home]);
  const missingReport = JSON.parse(missing.stdout) as {
    plans: Array<{ id: string; authSource?: string; error?: string }>;
    errors: Array<{ code: string }>;
  };
  const missingSg = missingReport.plans.find((p) => p.id === "supergrok");
  assert.equal(missingSg?.authSource, "missing");

  const prev = process.env.XAI_API_KEY;
  process.env.XAI_API_KEY = "from-env";
  try {
    const envDoctor = await runCli(["node", "modelpatrol", "doctor", "--home", home]);
    const envSg = (
      JSON.parse(envDoctor.stdout) as {
        plans: Array<{ id: string; authSource?: string }>;
      }
    ).plans.find((p) => p.id === "supergrok");
    assert.equal(envSg?.authSource, "env");
  } finally {
    if (prev === undefined) {
      delete process.env.XAI_API_KEY;
    } else {
      process.env.XAI_API_KEY = prev;
    }
  }

  writeCredential(home, "supergrok", {
    access: "oa",
    refresh: "r",
    expires: Date.now() + 1000,
  });
  const oauth = await runCli(["node", "modelpatrol", "doctor", "--home", home]);
  const oauthSg = (
    JSON.parse(oauth.stdout) as { plans: Array<{ id: string; authSource?: string }> }
  ).plans.find((p) => p.id === "supergrok");
  assert.equal(oauthSg?.authSource, "oauth");

  mkdirSync(join(home, "credentials"), { recursive: true });
  writeFileSync(join(home, "credentials", "supergrok.json"), "not json", {
    mode: 0o600,
  });
  const doctor = await runCli(["node", "modelpatrol", "doctor", "--home", home]);
  const report = JSON.parse(doctor.stdout) as {
    plans: Array<{
      id: string;
      authSource?: string;
      error?: string;
      authenticated: boolean;
    }>;
    errors: Array<{ plan: string; code: string }>;
  };
  const sg = report.plans.find((p) => p.id === "supergrok");
  assert.equal(sg?.authSource, "missing");
  assert.equal(sg?.error, "CONFIG_INVALID");
  assert.equal(sg?.authenticated, false);
  assert.equal(report.errors[0]?.code, "CONFIG_INVALID");
});

test("catalog prints providers, models, and levels", async () => {
  const result = await runCli(["node", "modelpatrol", "catalog"]);
  assert.equal(result.exitCode, 0);
  const payload = JSON.parse(result.stdout) as {
    providers: Array<{
      id: string;
      baseUrl: string;
      models: Array<{
        id: string;
        levels: Array<{ id: string; reasoning: string | null }>;
      }>;
    }>;
  };
  const ids = payload.providers.map((p) => p.id);
  assert.deepEqual(ids.sort(), ["openai", "xai"]);
  const xai = payload.providers.find((p) => p.id === "xai");
  assert.equal(xai?.baseUrl, "https://api.x.ai/v1");
  assert.equal(xai?.models[0]?.id, "grok-4.6");
  assert.equal(xai?.models[0]?.levels.find((l) => l.id === "high")?.reasoning, "high");
});

test("resolve --provider/--model/--level prints catalog route", async () => {
  const result = await runCli([
    "node",
    "modelpatrol",
    "resolve",
    "--provider",
    "xai",
    "--model",
    "grok-4.6",
    "--level",
    "high",
  ]);
  assert.equal(result.exitCode, 0);
  const payload = JSON.parse(result.stdout) as {
    provider: string;
    model: string;
    level: string;
    reasoning: string | null;
    baseUrl: string;
  };
  assert.equal(payload.provider, "xai");
  assert.equal(payload.model, "grok-4.6");
  assert.equal(payload.level, "high");
  assert.equal(payload.reasoning, "high");
  assert.equal(payload.baseUrl, "https://api.x.ai/v1");
});

test("resolve --provider without --model is USAGE", async () => {
  const result = await runCli(["node", "modelpatrol", "resolve", "--provider", "xai"]);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /USAGE/);
});

test("resolve unknown provider/model maps to typed errors", async () => {
  const badProvider = await runCli([
    "node",
    "modelpatrol",
    "resolve",
    "--provider",
    "nope",
    "--model",
    "grok-4.6",
  ]);
  assert.equal(badProvider.exitCode, 1);
  assert.match(badProvider.stderr, /PROVIDER_UNKNOWN/);

  const badModel = await runCli([
    "node",
    "modelpatrol",
    "resolve",
    "--provider",
    "xai",
    "--model",
    "nope",
  ]);
  assert.equal(badModel.exitCode, 1);
  assert.match(badModel.stderr, /MODEL_UNKNOWN/);
});

test("env --provider/--model includes provider exports", async () => {
  const home = mkdtempSync(join(tmpdir(), "modelpatrol-cli-"));
  await runCli(["node", "modelpatrol", "init", "--home", home]);
  const env = await runCli([
    "node",
    "modelpatrol",
    "env",
    "--home",
    home,
    "--provider",
    "openai",
    "--model",
    "gpt-5.6-luna",
  ]);
  assert.equal(env.exitCode, 0);
  assert.match(env.stdout, /MODELPATROL_PROVIDER=openai/);
  assert.match(env.stdout, /MODELPATROL_MODEL=gpt-5.6-luna/);
  assert.match(env.stdout, /MODELPATROL_LEVEL=default/);
  assert.match(env.stdout, /OPENAI_BASE_URL=/);
});

test("help lists catalog and the new resolve/env flags", async () => {
  const help = await runCli(["node", "modelpatrol", "--help"]);
  assert.match(help.stdout, /catalog/);
  assert.match(help.stdout, /--provider ID/);
  assert.match(help.stdout, /--model ID/);
  assert.match(help.stdout, /--level ID/);
  assert.match(help.stdout, /--intent ID/);
});

test("usage --provider returns provider windows via the injected fetch", async () => {
  const home = mkdtempSync(join(tmpdir(), "modelpatrol-cli-"));
  await runCli(["node", "modelpatrol", "init", "--home", home]);
  const prev = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "sk-cli";
  try {
    const usage = await runCli(
      ["node", "modelpatrol", "usage", "--provider", "openai", "--home", home],
      {
        fetchImpl: async (input) => {
          assert.match(String(input), /organization\/usage\/completions/);
          return {
            ok: true,
            status: 200,
            json: async () => ({ result: { week: { used: 10 }, month: { used: 40 } } }),
            text: async () => "",
            headers: new Headers(),
          } as Response;
        },
      },
    );
    assert.equal(usage.exitCode, 0);
    const payload = JSON.parse(usage.stdout) as {
      provider: string;
      windows: {
        fiveHour: { available: boolean };
        week: { available: boolean; used?: number };
      };
    };
    assert.equal(payload.provider, "openai");
    assert.equal(payload.windows.fiveHour.available, false);
    assert.equal(payload.windows.week.available, true);
    assert.equal(payload.windows.week.used, 10);
  } finally {
    if (prev === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = prev;
    }
  }
});

test("usage --provider with an unknown provider is USAGE", async () => {
  const result = await runCli(["node", "modelpatrol", "usage", "--provider", "nope"]);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /USAGE/);
});

test("usage --provider surfaces PLAN_UNAUTHENTICATED as exit 1", async () => {
  const home = mkdtempSync(join(tmpdir(), "modelpatrol-cli-"));
  await runCli(["node", "modelpatrol", "init", "--home", home]);
  const prev = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const prevCodex = process.env.CODEX_API_KEY;
  delete process.env.CODEX_API_KEY;
  try {
    const result = await runCli([
      "node",
      "modelpatrol",
      "usage",
      "--provider",
      "openai",
      "--home",
      home,
    ]);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /PLAN_UNAUTHENTICATED/);
  } finally {
    if (prev === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = prev;
    }
    if (prevCodex === undefined) {
      delete process.env.CODEX_API_KEY;
    } else {
      process.env.CODEX_API_KEY = prevCodex;
    }
  }
});

test("connect and disconnect support Codex device auth", async () => {
  const home = mkdtempSync(join(tmpdir(), "modelpatrol-codex-cli-"));
  await runCli(["node", "modelpatrol", "init", "--home", home]);
  const printed: string[] = [];
  let poll = false;
  let exchange = false;
  const connected = await runCli(
    [
      "node",
      "modelpatrol",
      "connect",
      "--plan",
      "codex",
      "--home",
      home,
      "--no-browser",
    ],
    {
      writeStdout: (value) => printed.push(value),
      sleep: async () => undefined,
      fetchImpl: async (input) => {
        if (String(input).includes("usercode")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              device_code: "dc",
              user_code: "CODE-1",
              expires_in: 300,
            }),
            text: async () => "",
            headers: new Headers(),
          } as Response;
        }
        if (poll) exchange = true;
        poll = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ...(poll && exchange
              ? { access_token: "codex-access" }
              : { code: "codex-code" }),
            refresh_token: "codex-refresh",
            expires_in: 3600,
          }),
          text: async () => "",
          headers: new Headers(),
        } as Response;
      },
    },
  );
  assert.equal(connected.exitCode, 0);
  assert.equal(poll, true);
  assert.equal(exchange, true);
  assert.equal(JSON.parse(printed[0] ?? "{}").plan, "codex");
  assert.equal(JSON.parse(connected.stdout).plan, "codex");

  const disconnected = await runCli([
    "node",
    "modelpatrol",
    "disconnect",
    "--plan",
    "codex",
    "--home",
    home,
  ]);
  assert.equal(disconnected.exitCode, 0);
  assert.equal(JSON.parse(disconnected.stdout).plan, "codex");
});

test("help warns about device-code phishing and lists Codex support", async () => {
  const help = await runCli(["node", "modelpatrol", "--help"]);
  assert.match(help.stdout, /codex or supergrok/);
  assert.match(help.stdout, /Never share a device code/);
});
