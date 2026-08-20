import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import { ModelpatrolError } from "../core/errors.js";
import { pidPath } from "./paths.js";

export function readPid(home: string): number | null {
  const path = pidPath(home);
  if (!existsSync(path)) {
    return null;
  }
  const raw = readFileSync(path, "utf8").trim();
  const pid = Number(raw);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

export function writePid(home: string, pid: number): void {
  writeFileSync(pidPath(home), `${pid}\n`);
}

export function clearPid(home: string): void {
  const path = pidPath(home);
  if (existsSync(path)) {
    rmSync(path);
  }
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function runningPid(home: string): number | null {
  const pid = readPid(home);
  if (pid === null) {
    return null;
  }
  if (!isAlive(pid)) {
    clearPid(home);
    return null;
  }
  return pid;
}

export function stopProcess(home: string): { pid: number } {
  const pid = runningPid(home);
  if (pid === null) {
    throw new ModelpatrolError("PROXY_NOT_RUNNING", "modelpatrol is not running");
  }
  process.kill(pid, "SIGTERM");
  clearPid(home);
  return { pid };
}

export function detachStart(argv: string[]): number {
  const child = spawn(process.execPath, argv, {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
  if (child.pid === undefined) {
    throw new ModelpatrolError("INTERNAL", "failed to spawn detached proxy");
  }
  return child.pid;
}
