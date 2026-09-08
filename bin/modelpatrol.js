#!/usr/bin/env node
import { mkdir, open, unlink } from "node:fs/promises";
import { join } from "node:path";

const VERSION = "1.0.0";
const HELP = `ModelPatrol ${VERSION} (Node.js 22.13+)

Usage:
  modelpatrol serve --config FILE   Start the centralized gateway and dashboard
  modelpatrol check --config FILE   Validate a closed Patrol 1.0 configuration
  modelpatrol --help                Show help
  modelpatrol --version             Show version

Default dashboard: http://127.0.0.1:4318`;
const [command, ...args] = process.argv.slice(2);
try {
  if (!command || ["--help", "-h"].includes(command)) {
    if (args.length) throw new Error("Help does not accept arguments");
    console.log(HELP);
  } else if (["--version", "version"].includes(command)) {
    if (args.length) throw new Error("Version does not accept arguments");
    console.log(VERSION);
  } else {
    if (
      !["serve", "check"].includes(command) ||
      args.length !== 2 ||
      args[0] !== "--config"
    )
      throw new Error("Use serve|check --config FILE, --help or --version");
    const [{ loadConfig }, { createGateway }] = await Promise.all([
      import("../src/config.mjs"),
      import("../src/server.mjs"),
    ]);
    const config = await loadConfig(args[1]);
    if (command === "check")
      console.log(
        JSON.stringify({
          protocolVersion: "1.0",
          valid: true,
          models: config.models.length,
        }),
      );
    else {
      await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
      const lockPath = join(config.dataDir, "server.lock");
      const lock = await open(lockPath, "wx", 0o600);
      await lock.writeFile(String(process.pid));
      let gateway;
      try {
        gateway = createGateway(config);
        await gateway.ready;
        await new Promise((resolve, reject) => {
          gateway.server.once("error", reject);
          gateway.server.listen(config.port, config.host, resolve);
        });
      } catch (error) {
        await lock.close();
        await unlink(lockPath);
        await gateway?.store.close();
        throw error;
      }
      console.error(
        `ModelPatrol listening on ${config.host}:${gateway.server.address().port}`,
      );
      let stopping = false;
      const stop = async () => {
        if (stopping) return;
        stopping = true;
        await gateway.close();
        await lock.close();
        await unlink(lockPath);
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
