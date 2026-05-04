/**
 * CostTracker: accumulate token usage across agents and compute run cost.
 *
 * Approximate per-model pricing (USD per 1M tokens, input/output blended ~60/40):
 *   claude-sonnet-4-6:  $3.00 / 1M input, $15.00 / 1M output
 *   gemini-2.5-flash:   $0.15 / 1M input, $0.60 / 1M output
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

const PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "gemini-2.5-flash": { input: 0.15, output: 0.6 },
};

export class CostTracker {
  private _entries: Array<{ model: string; usage: TokenUsage }> = [];

  record(model: string, usage: TokenUsage): void {
    this._entries.push({ model, usage });
  }

  totalCostUsd(): number {
    let total = 0;
    for (const { model, usage } of this._entries) {
      const pricing = PRICING[model];
      if (!pricing) continue;
      total += (usage.inputTokens / 1_000_000) * pricing.input;
      total += (usage.outputTokens / 1_000_000) * pricing.output;
    }
    return total;
  }

  totalCostUsdString(): string {
    return this.totalCostUsd().toFixed(6);
  }
}
