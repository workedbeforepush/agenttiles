// API list prices per model, for the API-equivalent cost of transcript usage. Source:
// https://platform.claude.com/docs/en/about-claude/pricing (2026-10-22). Update with new models.

interface ModelPrice {
  /** USD per million input tokens; cache writes cost 1.25x (5 minutes) or 2x (1 hour) of it. */
  input: number;
  output: number;
  /** Cache reads as a fraction of `input`. */
  cacheRead: number;
  /** Fast mode input / output (`usage.speed: "fast"`). */
  fast?: { input: number; output: number };
  /** Prices for prompts over `overTokens` input tokens (cache reads and writes included). */
  long?: { overTokens: number; input: number; output: number };
}

/** Matched by prefix, so dated ids (`claude-sonnet-4-5-20250929`) find their model. More specific ids first. */
const PRICES: [string, ModelPrice][] = [
  ['claude-fable-5-1', { input: 10, output: 50, cacheRead: 0.025 }],
  ['claude-mythos-5-1', { input: 10, output: 50, cacheRead: 0.025 }],
  ['claude-fable-5', { input: 10, output: 50, cacheRead: 0.1 }],
  ['claude-mythos-5', { input: 10, output: 50, cacheRead: 0.1 }],
  ['claude-opus-5-5', { input: 4, output: 20, cacheRead: 0.05, fast: { input: 8, output: 40 } }],
  ['claude-opus-5', { input: 5, output: 25, cacheRead: 0.1, fast: { input: 10, output: 50 } }],
  ['claude-opus-4-8', { input: 5, output: 25, cacheRead: 0.1, fast: { input: 10, output: 50 } }],
  ['claude-opus-4-7', { input: 5, output: 25, cacheRead: 0.1 }],
  ['claude-opus-4-6', { input: 5, output: 25, cacheRead: 0.1 }],
  ['claude-opus-4-5', { input: 5, output: 25, cacheRead: 0.1 }],
  ['claude-opus-4', { input: 15, output: 75, cacheRead: 0.1 }],
  ['claude-sonnet-5-5', { input: 2, output: 10, cacheRead: 0.05 }],
  ['claude-sonnet-5', { input: 2, output: 10, cacheRead: 0.1 }],
  ['claude-sonnet-4', { input: 3, output: 15, cacheRead: 0.1 }],
  ['claude-haiku-5-5', { input: 0.1, output: 0.5, cacheRead: 0.1, long: { overTokens: 100_000, input: 0.5, output: 2.5 } }],
  ['claude-haiku-4-5', { input: 1, output: 5, cacheRead: 0.1 }],
  ['claude-3-5-haiku', { input: 0.8, output: 4, cacheRead: 0.1 }],
];

/** Web search: $10 per 1,000 searches. */
const WEB_SEARCH_USD = 0.01;
/** US-only inference (`inference_geo: "us"`) costs 1.1x on every token price. */
const US_ONLY = 1.1;

export interface TokenUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cacheReadTokens: number;
  webSearches: number;
  fast: boolean;
  usOnly: boolean;
}

/** API-equivalent cost in USD, or null for a model without a known price. */
export function usageCost(u: TokenUsage): number | null {
  const price = PRICES.find(([prefix]) => u.model.startsWith(prefix))?.[1];
  if (!price) return null;
  const prompt = u.inputTokens + u.cacheWrite5mTokens + u.cacheWrite1hTokens + u.cacheReadTokens;
  let { input, output } = price;
  if (u.fast && price.fast) ({ input, output } = price.fast);
  else if (price.long && prompt > price.long.overTokens) ({ input, output } = price.long);
  const tokens =
    u.inputTokens * input +
    u.cacheWrite5mTokens * input * 1.25 +
    u.cacheWrite1hTokens * input * 2 +
    u.cacheReadTokens * input * price.cacheRead +
    u.outputTokens * output;
  return (tokens / 1_000_000) * (u.usOnly ? US_ONLY : 1) + u.webSearches * WEB_SEARCH_USD;
}
