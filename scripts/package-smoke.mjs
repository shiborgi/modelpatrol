import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const dir = await mkdtemp(join(tmpdir(), "modelpatrol-package-"));
function run(command, args, cwd = process.cwd(), cleanStderr = false) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(result.stderr || result.stdout || "Package smoke failed");
  if (cleanStderr && result.stderr)
    throw new Error(`Unexpected stderr: ${result.stderr}`);
  return result.stdout;
}
try {
  const info = JSON.parse(
    run("npm", [
      "pack",
      "--json",
      "--pack-destination",
      dir,
      "--cache",
      join(dir, "cache"),
    ]),
  )[0];
  run("npm", [
    "install",
    "--prefix",
    join(dir, "installed"),
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--cache",
    join(dir, "cache"),
    join(dir, info.filename),
  ]);
  const installed = join(dir, "installed/node_modules/modelpatrol");
  run(process.execPath, [join(installed, "bin/modelpatrol.js"), "--help"], dir, true);
  if (
    run(
      process.execPath,
      [join(installed, "bin/modelpatrol.js"), "--version"],
      dir,
      true,
    ).trim() !==
    "1.0.0"
  )
    throw new Error("Installed package reported the wrong version");
  run(
    process.execPath,
    [
      join(installed, "bin/modelpatrol.js"),
      "check",
      "--config",
      join(installed, "examples/modelpatrol.json"),
    ],
    dir,
  );
  console.log("Installed package CLI and configuration passed");
} finally {
  await rm(dir, { recursive: true, force: true });
}
