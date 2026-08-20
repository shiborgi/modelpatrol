import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { loadConfig, writeDefaultConfig } from "../src/config/load.js";
import { BUILTIN_PLAN_IDS, CODE_INTENTS } from "../src/core/constants.js";

test("writeDefaultConfig creates a home config once", () => {
  const home = mkdtempSync(join(tmpdir(), "modelpatrol-cfg-"));
  const first = writeDefaultConfig(home);
  assert.equal(first.created, true);
  assert.equal(existsSync(first.path), true);
  const second = writeDefaultConfig(home);
  assert.equal(second.created, false);
  const loaded = loadConfig(home);
  for (const id of BUILTIN_PLAN_IDS) {
    assert.ok(loaded.config.plans[id], `missing plan ${id}`);
  }
  for (const intent of CODE_INTENTS) {
    assert.ok(loaded.config.intents[intent], `missing intent ${intent}`);
  }
  JSON.parse(readFileSync(first.path, "utf8"));
});

test("loadConfig returns defaults when the file is missing", () => {
  const home = mkdtempSync(join(tmpdir(), "modelpatrol-missing-"));
  const loaded = loadConfig(home);
  assert.equal(loaded.config.schemaVersion, 1);
  assert.equal(loaded.config.port, 4200);
});
