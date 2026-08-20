import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyReasoning,
  extractSseUsage,
  extractUsage,
  inboundProtocol,
  translateBody,
} from "../src/providers/translate.js";

test("inboundProtocol classifies OpenAI, Anthropic and Responses paths", () => {
  assert.equal(inboundProtocol("/v1/chat/completions"), "openai");
  assert.equal(inboundProtocol("/v1/messages"), "anthropic");
  assert.equal(inboundProtocol("/v1/responses"), "responses");
  assert.equal(inboundProtocol("/health"), null);
});

test("openai chat translates to anthropic messages", () => {
  const out = translateBody(
    {
      model: "spec",
      messages: [
        { role: "system", content: "be brief" },
        { role: "user", content: "hello" },
      ],
      max_tokens: 32,
    },
    "openai",
    "anthropic",
    "claude-sonnet",
  );
  assert.equal(out.path, "/messages");
  assert.equal(out.body.model, "claude-sonnet");
  assert.equal(out.body.system, "be brief");
  assert.equal(Array.isArray(out.body.messages), true);
});

test("extractUsage reads OpenAI and Anthropic shapes", () => {
  assert.deepEqual(
    extractUsage({ usage: { prompt_tokens: 3, completion_tokens: 5 } }),
    { promptTokens: 3, completionTokens: 5 },
  );
  assert.deepEqual(extractUsage({ usage: { input_tokens: 2, output_tokens: 9 } }), {
    promptTokens: 2,
    completionTokens: 9,
  });
});

test("extractSseUsage reads the last usage chunk", () => {
  const chunks = [
    'data: {"choices":[]}',
    'data: {"usage":{"prompt_tokens":11,"completion_tokens":7}}',
    "data: [DONE]",
  ].join("\n");
  assert.deepEqual(extractSseUsage(chunks), { promptTokens: 11, completionTokens: 7 });
});

test("applyReasoning injects reasoning_effort only when non-null", () => {
  const body = { model: "grok-4.6", messages: [] };
  assert.equal(applyReasoning(body, "high").reasoning_effort, "high");
  assert.equal(applyReasoning(body, "xhigh").reasoning_effort, "xhigh");
  assert.equal("reasoning_effort" in applyReasoning(body, null), false);
  assert.equal("reasoning_effort" in applyReasoning(body, null), false);
});
