import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeResetISO, parseClaudeUsageText } from "../src/claude-account.mjs";

const NOW = new Date(2026, 8, 7, 15, 0, 0);

test("claudeResetISO resolves month/day/time with inferred year", () => {
  assert.equal(
    claudeResetISO("Sep 7 at 4:19pm (America/Sao_Paulo)", NOW),
    new Date(2026, 8, 7, 16, 19, 0).toISOString(),
  );
  assert.equal(
    claudeResetISO("Sep 11 at 3:59am (America/Sao_Paulo)", NOW),
    new Date(2026, 8, 11, 3, 59, 0).toISOString(),
  );
});

test("claudeResetISO rolls past dates to next year", () => {
  assert.equal(
    claudeResetISO("Jan 2 at 1:00am (UTC)", NOW),
    new Date(2027, 0, 2, 1, 0, 0).toISOString(),
  );
});

test("claudeResetISO passes unparseable text through", () => {
  assert.equal(claudeResetISO("tomorrow", NOW), "tomorrow");
  assert.equal(claudeResetISO(null, NOW), null);
});

test("parseClaudeUsageText extracts session and week with ISO resets", () => {
  const result = parseClaudeUsageText(
    "Current session: 100% used · resets Sep 7 at 4:19pm (America/Sao_Paulo)\nCurrent week (all models): 29% used · resets Sep 11 at 3:59am (America/Sao_Paulo)\n",
    NOW,
  );
  assert.equal(result.session.usedPercent, 100);
  assert.equal(result.session.resetsAt, new Date(2026, 8, 7, 16, 19, 0).toISOString());
  assert.equal(result.week.usedPercent, 29);
  assert.equal(result.week.resetsAt, new Date(2026, 8, 11, 3, 59, 0).toISOString());
});

test("parseClaudeUsageText maps missing sections to null", () => {
  assert.deepEqual(parseClaudeUsageText("nothing here", NOW), {
    session: null,
    week: null,
  });
});
