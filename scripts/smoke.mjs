import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const bin = join(process.cwd(), "bin", "modelpatrol.js");

function runCli(args, extra = {}) {
  const result = spawnSync("node", [bin, ...args], {
    encoding: "utf8",
    ...extra,
  });
  if (result.status !== 0) {
    throw new Error(`CLI failed (${result.status}): ${result.stderr}`);
  }
  return result.stdout;
}

const checks = [];
function check(name, fn) {
  try {
    fn();
    checks.push(`  ok  ${name}`);
  } catch (err) {
    checks.push(`FAIL  ${name}: ${err.message}`);
    process.exitCode = 1;
  }
}

const home = mkdtempSync(join(tmpdir(), "modelpatrol-smoke-"));

const version = runCli(["--version"]).trim();
check("version is semver", () => {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(version);
  }
});

const init = JSON.parse(runCli(["init", "--home", home]));
check("init writes config", () => {
  if (!init.created) throw new Error("config not created");
});

const doctor = JSON.parse(runCli(["doctor", "--home", home]));
check("doctor lists golden-path intents", () => {
  for (const intent of [
    "spec",
    "spec-review",
    "plan",
    "plan-review",
    "build",
    "build-review",
    "ship",
  ]) {
    if (!doctor.intents.includes(intent)) throw new Error(`missing ${intent}`);
  }
});

const resolved = JSON.parse(runCli(["resolve", "--home", home, "--intent", "build"]));
check("build routes to codex", () => {
  if (resolved.plan !== "codex") throw new Error(JSON.stringify(resolved));
});

const env = runCli(["env", "--home", home, "--intent", "spec"]);
check("env exports base URLs", () => {
  if (!env.includes("OPENAI_BASE_URL=")) throw new Error(env);
  if (!env.includes("MODELPATROL_INTENT=spec")) throw new Error(env);
});

const child = spawn(
  "node",
  [bin, "start", "--home", home, "--host", "127.0.0.1", "--port", "0"],
  {
    encoding: "utf8",
  },
);

const started = await new Promise((resolve, reject) => {
  let buf = "";
  const timer = setTimeout(() => reject(new Error("start timed out")), 5000);
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    const line = buf.split("\n").find((item) => item.startsWith("{"));
    if (!line) return;
    clearTimeout(timer);
    resolve(JSON.parse(line));
  });
  child.stderr.on("data", (chunk) => {
    buf += chunk;
  });
  child.on("exit", (code) => {
    if (code) {
      clearTimeout(timer);
      reject(new Error(`start exited ${code}: ${buf}`));
    }
  });
});

try {
  const health = await fetch(`http://127.0.0.1:${started.port}/health`);
  check("proxy /health", () => {
    if (!health.ok) throw new Error(String(health.status));
  });
  const usage = await fetch(`http://127.0.0.1:${started.port}/v1/usage`);
  const body = await usage.json();
  check("proxy /v1/usage has three windows", () => {
    if (body.windows?.length !== 3) throw new Error(JSON.stringify(body));
  });
} finally {
  child.kill("SIGTERM");
}

const usage = JSON.parse(runCli(["usage", "--home", home]));
check("usage CLI has three windows", () => {
  if (usage.windows?.length !== 3) throw new Error(JSON.stringify(usage));
});

console.log("smoke:");
for (const line of checks) {
  console.log(line);
}

rmSync(home, { recursive: true, force: true });
