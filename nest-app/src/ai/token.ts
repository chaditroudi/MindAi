/**
 * TokenUsage
 * ----------
 * The universal shape every LLM call in this app reports its cost as.
 * Every skill (planner, chart, writer, memory) returns one of these
 * alongside its result, and AnalyticsService sums them all together across
 * a single request (planner call + chart/writer call + memory-extraction
 * call can all happen in one HTTP request) before persisting the total
 * against whichever budget (pooled agent or personal key) was used.
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Combines two usage totals — used to accumulate cost across multiple LLM calls in one request. */
export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
}

/** A fresh zero-cost usage record — the starting value before any LLM call has run, or the value returned when a cache hit skips the LLM entirely. */
export const zeroUsage = (): TokenUsage => ({
  inputTokens: 0,
  outputTokens: 0,
});
