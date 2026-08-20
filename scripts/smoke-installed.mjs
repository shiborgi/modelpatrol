import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8" });
}

const root = process.cwd();
const packDir = mkdtempSync(join(tmpdir(), "modelpatrol-pack-"));
run("npm", ["pack", "--pack-destination", packDir, "--silent"], root);
const tarball = join(packDir, `modelpatrol-${pkg.version}.tgz`);

const installDir = mkdtempSync(join(tmpdir(), "modelpatrol-install-"));
writeFileSync(join(installDir, "package.json"), '{"name":"probe","version":"1.0.0"}');
run("npm", ["install", tarball, "--no-audit", "--no-fund"], installDir);

const bin = join(installDir, "node_modules", ".bin", "modelpatrol");
const home = mkdtempSync(join(tmpdir(), "modelpatrol-home-"));

const version = run(bin, ["--version"], installDir).trim();
if (version !== pkg.version) {
  console.error(`expected version ${pkg.version}, got ${version}`);
  process.exit(1);
}

run(bin, ["init", "--home", home], installDir);
const doctor = JSON.parse(run(bin, ["doctor", "--home", home], installDir));
if (!doctor.ok || !doctor.intents.includes("ship")) {
  console.error(`doctor failed: ${JSON.stringify(doctor)}`);
  process.exit(1);
}

const resolved = JSON.parse(
  run(bin, ["resolve", "--home", home, "--intent", "plan-review"], installDir),
);
if (resolved.plan !== "supergrok") {
  console.error(`unexpected route: ${JSON.stringify(resolved)}`);
  process.exit(1);
}

console.log("smoke-installed: ok (tarball installs and runs init/doctor/resolve)");
rmSync(packDir, { recursive: true, force: true });
rmSync(installDir, { recursive: true, force: true });
rmSync(home, { recursive: true, force: true });
