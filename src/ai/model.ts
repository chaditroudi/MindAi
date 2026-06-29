import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModelV1 } from 'ai';

export type AgentRole = 'supervisor' | 'writer' | 'chart';


export const PROVIDERS: Record<string, string> = {
  groq:       'https://api.groq.com/openai/v1',
  openai:     'https://api.openai.com/v1',
  google:     'https://generativelanguage.googleapis.com/v1beta/openai',
  anthropic:  'https://api.anthropic.com/v1',
  mistral:    'https://api.mistral.ai/v1',
  together:   'https://api.together.xyz/v1',
  perplexity: 'https://api.perplexity.ai',
};

// Returns null when the key prefix doesn't match a known provider — no silent groq fallback.
export function detectProvider(apiKey: string): string | null {
  if (apiKey.startsWith('gsk_'))   return 'groq';
  if (apiKey.startsWith('sk-ant-')) return 'anthropic';
  if (apiKey.startsWith('AIza'))   return 'google';
  if (apiKey.startsWith('sk-'))    return 'openai';
  return null;
}

export function resolveModel(
  role:      AgentRole,
  apiKey?:   string,
  model?:    string,
  provider?: string,
): LanguageModelV1 {
  const key              = apiKey?.trim() ?? '';
  const resolvedModel    = model?.trim();
  const resolvedProvider = provider?.trim().toLowerCase() || detectProvider(key);
  const baseURL          = resolvedProvider ? PROVIDERS[resolvedProvider] : undefined;

  if (!key) {
    throw new Error(
      `No API key configured for role "${role}". ` +
      `Please add one in Settings.`,
    );
  }
  if (!resolvedProvider || !baseURL) {
    throw new Error(
      `No provider configured for role "${role}". ` +
      `Please select a provider in Settings.`,
    );
  }
  if (!resolvedModel) {
    throw new Error(
      `No model configured for role "${role}" (provider: ${resolvedProvider}). ` +
      `Please select a model in Settings.`,
    );
  }

  return createOpenAI({ apiKey: key, baseURL, compatibility: 'compatible' }).chat(resolvedModel);
}

export function freshSignal(_role: AgentRole, timeoutMs?: number): AbortSignal | undefined {
  const ms = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.round(timeoutMs)
    : undefined;
  return ms ? AbortSignal.timeout(ms) : undefined;
}
