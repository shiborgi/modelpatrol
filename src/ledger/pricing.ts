import type { Config } from "../core/model.js";

export function estimateCostUsd(
  config: Config,
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const price = config.pricing[model] ?? {
    inputPerMillion: 0,
    outputPerMillion: 0,
  };
  const cost =
    (promptTokens / 1_000_000) * price.inputPerMillion +
    (completionTokens / 1_000_000) * price.outputPerMillion;
  return roundUsd(cost);
}

export function estimateTokensFromText(text: string): number {
  if (!text) {
    return 0;
  }
  return Math.max(1, Math.ceil(text.length / 4));
}

export function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
