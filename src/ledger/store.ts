import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import type { LedgerEvent } from "../core/model.js";
import { ledgerEventSchema } from "../core/schemas.js";
import { ledgerPath } from "../infra/paths.js";

export function appendEvent(home: string, event: LedgerEvent): void {
  const path = ledgerPath(home);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`);
}

export function readEvents(home: string): LedgerEvent[] {
  const path = ledgerPath(home);
  if (!existsSync(path)) {
    return [];
  }
  const events: LedgerEvent[] = [];
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const event = parseEventLine(line);
    if (event) {
      events.push(event);
    }
  }
  return events;
}

function parseEventLine(line: string): LedgerEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  const parsed = ledgerEventSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
