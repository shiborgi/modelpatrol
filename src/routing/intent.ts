import { CODE_INTENTS, HARNESS_HEADER, INTENT_HEADER } from "../core/constants.js";
import type { Config } from "../core/model.js";

export function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

export function extractIntent(input: {
  config: Config;
  headers: Record<string, string | string[] | undefined>;
  queryIntent?: string | null;
  model?: string | null;
}): string {
  const fromHeader = headerValue(input.headers, INTENT_HEADER);
  if (fromHeader?.trim()) {
    return fromHeader.trim();
  }
  if (input.queryIntent?.trim()) {
    return input.queryIntent.trim();
  }
  const model = input.model?.trim() ?? "";
  if (model && (input.config.intents[model] || isKnownIntentName(model))) {
    return model;
  }
  return input.config.defaultIntent;
}

export function extractHarness(
  headers: Record<string, string | string[] | undefined>,
): string | null {
  const value = headerValue(headers, HARNESS_HEADER);
  return value?.trim() ? value.trim() : null;
}

export function isKnownIntentName(value: string): boolean {
  return (CODE_INTENTS as readonly string[]).includes(value);
}
