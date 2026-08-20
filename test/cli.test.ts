import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { runCli } from "../src/cli/index.js";

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
