import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAgyUsage } from "../src/antigravity-account.mjs";

const reply = (groups) =>
  JSON.stringify({
    conversation_id: "",
    status: "SUCCESS",
    response: "table",
    usage: { input_tokens: 0, output_tokens: 0 },
    command: { name: "usage", data: { description: "quota", groups } },
  });
const bucket = (overrides = {}) => ({
  id: "3p-weekly",
  name: "Weekly Limit Remaining",
  window: "weekly",
  remaining_fraction: 0.999,
  reset_time: "2026-09-14T18:46:07Z",
  ...overrides,
});

test("parseAgyUsage returns sanitized groups and buckets", () => {
  const result = parseAgyUsage(
    reply([
      { name: "Claude and GPT models", description: "Claude Sonnet", buckets: [bucket(), bucket({ id: "3p-5h", name: "Five Hour Limit Remaining", window: "5h", remaining_fraction: 1, reset_time: "2026-09-07T23:46:07Z" })] },
    ]),
  );
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].name, "Claude and GPT models");
  assert.equal(result.groups[0].buckets[0].remainingFraction, 0.999);
  assert.equal(result.groups[0].buckets[1].resetTime, "2026-09-07T23:46:07Z");
});

test("parseAgyUsage rejects non-SUCCESS or foreign commands", () => {
  assert.throws(() => parseAgyUsage(reply([]).replace("SUCCESS", "ERROR")), /failed/);
  assert.throws(() => parseAgyUsage(reply([]).replace('"name":"usage"', '"name":"other"')), /failed/);
  assert.throws(() => parseAgyUsage("not json"), /Invalid/);
});

test("parseAgyUsage maps malformed buckets to null instead of fabricating", () => {
  const result = parseAgyUsage(
    reply([{ name: "G", buckets: [bucket({ remaining_fraction: 2 }), bucket({ remaining_fraction: -1, reset_time: 42 })] }]),
  );
  assert.equal(result.groups[0].buckets[0].remainingFraction, null);
  assert.equal(result.groups[0].buckets[1].remainingFraction, null);
  assert.equal(result.groups[0].buckets[1].resetTime, null);
});

test("parseAgyUsage rejects missing groups", () => {
  assert.throws(() => parseAgyUsage(reply([])), /no limit groups/);
  assert.throws(() => parseAgyUsage(reply(null).replace("null", "42")), /no limit groups/);
});
