import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";

const metadataKeys = [
  "step",
  "agent",
  "profile",
  "harness",
  "project",
  "run-id",
  "session-id",
  "trace-id",
];
const month = () => `${new Date().toISOString().slice(0, 7)}-01T00:00:00.000Z`;
const boundedLimit = (value) =>
  Math.min(Math.max(Number(value) || 500, 1), 10000);

/** SQLite is the local, single-process storage backend. */
export class Store {
  constructor(directory) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, "usage.sqlite");
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, time TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS requests_time ON requests(time);`);
    this.ready = Promise.resolve();
  }
  record(event) {
    this.db
      .prepare(
        "INSERT INTO requests VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(event.id, event.time, JSON.stringify(event));
  }
  events(filters = {}) {
    const clauses = ["time >= ?", "time <= ?"];
    const args = [filters.from || "0000", filters.to || "9999"];
    for (const key of ["model", "provider", "status"])
      if (filters[key]) {
        clauses.push(`json_extract(data, '$.${key}') = ?`);
        args.push(filters[key]);
      }
    for (const key of metadataKeys)
      if (filters[key]) {
        clauses.push(`json_extract(data, '$.metadata."${key}"') = ?`);
        args.push(filters[key]);
      }
    return this.db
      .prepare(
        `SELECT data FROM requests WHERE ${clauses.join(" AND ")} ORDER BY time DESC LIMIT ?`,
      )
      .all(...args, boundedLimit(filters.limit))
      .map((row) => JSON.parse(row.data));
  }
  monthlyCost() {
    return this.sum("costUsd");
  }
  monthlyReservations() {
    return this.sum("budgetReservationUsd");
  }
  sum(field) {
    return this.db
      .prepare(
        `SELECT COALESCE(SUM(json_extract(data, '$.${field}')),0) AS cost FROM requests WHERE time >= ?`,
      )
      .get(month()).cost;
  }
  close() {
    this.db.close();
  }
}

export function summarize(events, groupBy = "model") {
  const groups = new Map();
  for (const event of events) {
    const key = event[groupBy] ?? event.metadata?.[groupBy] ?? "unknown";
    const row = groups.get(key) ?? {
      key,
      requests: 0,
      errors: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
      unknownUsage: 0,
      unknownCost: 0,
      cacheHits: 0,
      latencies: [],
      firstTokens: [],
    };
    row.requests++;
    row.errors += event.status !== "ok" ? 1 : 0;
    row.cacheHits += event.cacheHit ? 1 : 0;
    if (event.usage)
      for (const field of [
        "inputTokens",
        "outputTokens",
        "cacheReadTokens",
        "cacheWriteTokens",
      ])
        row[field] += event.usage[field] ?? 0;
    else row.unknownUsage++;
    if (event.costUsd === null) row.unknownCost++;
    else row.costUsd += event.costUsd;
    row.latencies.push(event.durationMs);
    if (event.ttftMs != null) row.firstTokens.push(event.ttftMs);
    groups.set(key, row);
  }
  return [...groups.values()].map(({ latencies, firstTokens, ...row }) => {
    latencies.sort((a, b) => a - b);
    return {
      ...row,
      errorRate: row.errors / row.requests,
      p50Ms: latencies[Math.ceil(latencies.length * 0.5) - 1],
      p95Ms: latencies[Math.ceil(latencies.length * 0.95) - 1],
      averageTtftMs: firstTokens.length
        ? firstTokens.reduce((a, b) => a + b, 0) / firstTokens.length
        : null,
    };
  });
}
