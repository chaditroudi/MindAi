export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface TokenUsage {
  inputTokens:  number;
  outputTokens: number;
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens:  a.inputTokens  + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
}

export const zeroUsage = (): TokenUsage => ({ inputTokens: 0, outputTokens: 0 });
