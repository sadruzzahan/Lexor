/**
 * Per-model USD cost per 1M tokens. Single source of truth — when a
 * provider changes its rate card, only this file moves. Kept tiny so
 * onboarding new models in the ModelRouter is one line each.
 *
 * Numbers are list price in USD per 1,000,000 tokens. Anything not
 * listed falls back to DEFAULT_PRICE so an unknown model never causes
 * a NaN cost downstream.
 */
export interface ModelPrice {
  inputPerM: number;
  outputPerM: number;
  /** Optional cached-input price (Anthropic prompt cache, OpenAI cached). */
  cachedInputPerM?: number;
}

export const DEFAULT_PRICE: ModelPrice = { inputPerM: 3, outputPerM: 15 };

/**
 * Anthropic / OpenAI / Gemini list prices as of 2026-05. Numbers are
 * documented inline so future audits can spot stale entries.
 */
export const PRICES: Record<string, ModelPrice> = {
  // Anthropic
  "claude-sonnet-4-6": { inputPerM: 3, outputPerM: 15, cachedInputPerM: 0.3 },
  "claude-haiku-4": { inputPerM: 0.8, outputPerM: 4 },
  // OpenAI
  "gpt-5-mini": { inputPerM: 0.25, outputPerM: 2 },
  "gpt-5": { inputPerM: 1.25, outputPerM: 10 },
  // Gemini
  "gemini-3-flash-preview": { inputPerM: 0.1, outputPerM: 0.4 },
  // Embeddings (input tokens only; outputPerM=0).
  "text-embedding-3-small": { inputPerM: 0.02, outputPerM: 0 },
  "text-embedding-3-large": { inputPerM: 0.13, outputPerM: 0 },
};

export function priceFor(model: string): ModelPrice {
  return PRICES[model] ?? DEFAULT_PRICE;
}

/** Compute USD cost for an LLM call given token counts. */
export function usdCost(args: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}): number {
  const p = priceFor(args.model);
  const inputBase = Math.max(0, args.inputTokens - (args.cachedInputTokens ?? 0));
  const cached = args.cachedInputTokens ?? 0;
  const cachedRate = p.cachedInputPerM ?? p.inputPerM;
  const cost =
    (inputBase * p.inputPerM + cached * cachedRate + args.outputTokens * p.outputPerM) /
    1_000_000;
  return Math.max(0, +cost.toFixed(6));
}
