import { homedir } from "node:os";
import { join } from "node:path";

export function resolveHome(override?: string): string {
  return override ?? process.env.MODELPATROL_HOME ?? join(homedir(), ".modelpatrol");
}

export function configPath(home: string): string {
  return process.env.MODELPATROL_CONFIG ?? join(home, "config.json");
}

export function ledgerPath(home: string): string {
  return join(home, "ledger.jsonl");
}

export function pidPath(home: string): string {
  return join(home, "proxy.pid");
}
