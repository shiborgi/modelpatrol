import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { grokUsage } from "../src/grok-account.mjs";

const snapshot = (percent, start, end) =>
  JSON.stringify({
    ts: "2026-09-07T18:34:10.449Z",
    msg: "billing: fetched credits config",
    ctx: {
      config: {
        creditUsagePercent: percent,
        currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", start, end },
        onDemandUsed: { val: 0 },
        prepaidBalance: { val: 0 },
      },
      subscriptionTier: "SuperGrok",
    },
  });

async function fixture(t, content) {
  const dir = await mkdtemp(join(tmpdir(), "modelpatrol-grok-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "unified.jsonl");
  await writeFile(path, content);
  return path;
}

test("grokUsage returns the latest billing snapshot", async (t) => {
  const path = await fixture(
    t,
    [
      snapshot(4.0, "2026-08-25T00:00:00+00:00", "2026-09-01T00:00:00+00:00"),
      '{"ts":"2026-09-07T18:33:59Z","msg":"shell.handle_prompt.done","ctx":{}}',
      snapshot(100.0, "2026-09-01T00:11:38.402721+00:00", "2026-09-08T00:11:38.402721+00:00"),
      "not json {{{",
    ].join("\n"),
  );
  const result = await grokUsage({ logPath: path });
  assert.equal(result.tier, "SuperGrok");
  assert.equal(result.creditUsagePercent, 100.0);
  assert.equal(result.period.type, "USAGE_PERIOD_TYPE_WEEKLY");
  assert.equal(result.period.end, "2026-09-08T00:11:38.402721+00:00");
});

test("grokUsage rejects a missing log", async () => {
  await assert.rejects(
    grokUsage({ logPath: "/nonexistent/unified.jsonl" }),
    /not available/,
  );
});

test("grokUsage rejects a log without billing snapshots", async (t) => {
  const path = await fixture(t, '{"msg":"other"}\n');
  await assert.rejects(grokUsage({ logPath: path }), /No Grok billing snapshot/);
});

test("grokUsage rejects an unknown home", async () => {
  await assert.rejects(grokUsage({ home: "" }), /unknown/);
});
