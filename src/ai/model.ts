import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModelV1 } from 'ai';
import { config } from '../config.js';

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

export function detectProvider(apiKey: string): string {
  if (apiKey.startsWith('sk-ant-')) return 'anthropic';
  if (apiKey.startsWith('AIza'))   return 'google';
  if (apiKey.startsWith('sk-'))    return 'openai';
  return 'groq';
}

export function resolveModel(
  role:      AgentRole,
  apiKey?:   string,
  model?:    string,
  provider?: string,
): LanguageModelV1 {
  const key          = apiKey   ?? config.llm.apiKey   ?? '';
  const resolvedModel    = model    ?? config.llm.model;
  const resolvedProvider = provider ?? config.llm.provider ?? detectProvider(key);
  const baseURL          = PROVIDERS[resolvedProvider];

  if (!resolvedModel) {
    throw new Error(
      `No model configured for role "${role}" (provider: ${resolvedProvider}). ` +
      `Please select a model in Settings.`,
    );
  }

  return createOpenAI({ apiKey: key, baseURL })(resolvedModel);
}

export function freshSignal(role: AgentRole): AbortSignal {
  return AbortSignal.timeout(config.llm.timeouts[role]);
}
