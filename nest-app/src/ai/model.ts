import { createOpenAI }              from '@ai-sdk/openai';
import { createAnthropic }           from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI }  from '@ai-sdk/google';
import type { LanguageModelV1 }      from 'ai';

export type AgentRole  = 'supervisor' | 'writer' | 'chart' | 'memory';
export type AIProvider = 'groq' | 'openai' | 'anthropic' | 'google';

const ROLE_ENV_KEYS: Record<AgentRole, string> = {
  supervisor: 'SUPERVISOR_MODEL',
  chart:      'CHART_MODEL',
  writer:     'WRITER_MODEL',
  memory:     'MEMORY_MODEL',
};

const TIMEOUT_ENV_KEYS: Record<AgentRole, string> = {
  supervisor: 'SUPERVISOR_TIMEOUT_MS',
  chart:      'CHART_TIMEOUT_MS',
  writer:     'WRITER_TIMEOUT_MS',
  memory:     'WRITER_TIMEOUT_MS',
};

const PROVIDER_DEFAULTS: Record<AIProvider, Record<AgentRole, string>> = {
  groq: {
    supervisor: 'llama-3.3-70b-versatile',
    chart:      'llama-3.3-70b-versatile',
    writer:     'llama-3.1-8b-instant',
    memory:     'llama-3.1-8b-instant',
  },
  openai: {
    supervisor: 'gpt-4o-mini',
    chart:      'gpt-4o-mini',
    writer:     'gpt-4o-mini',
    memory:     'gpt-4o-mini',
  },
  anthropic: {
    supervisor: 'claude-sonnet-4-6',
    chart:      'claude-sonnet-4-6',
    writer:     'claude-haiku-4-5-20251001',
    memory:     'claude-haiku-4-5-20251001',
  },
  google: {
    supervisor: 'gemini-2.0-flash',
    chart:      'gemini-2.0-flash',
    writer:     'gemini-2.0-flash',
    memory:     'gemini-2.0-flash',
  },
};

export function detectProvider(apiKey: string): AIProvider {
  if (apiKey.startsWith('sk-ant-')) return 'anthropic';
  if (apiKey.startsWith('AIza'))   return 'google';
  if (apiKey.startsWith('sk-'))    return 'openai';
  return 'groq';
}

export function resolveModel(role: AgentRole, apiKey?: string, userModel?: string): LanguageModelV1 {
  const key      = apiKey ?? process.env['GROQ_API_KEY'] ?? process.env['OPENAI_API_KEY'] ?? '';
  const provider = detectProvider(key);
  const model    = userModel ?? process.env[ROLE_ENV_KEYS[role]]?.trim() ?? PROVIDER_DEFAULTS[provider][role];

  switch (provider) {
    case 'anthropic':
      return createAnthropic({ apiKey: key })(model);
    case 'google':
      return createGoogleGenerativeAI({ apiKey: key })(model);
    case 'openai':
      return createOpenAI({ apiKey: key })(model);
    default:
      return createOpenAI({
        baseURL:       'https://api.groq.com/openai/v1',
        apiKey:        key,
        compatibility: 'compatible',
      })(model);
  }
}

export function freshSignal(role: AgentRole): AbortSignal {
  const ms = Number(process.env[TIMEOUT_ENV_KEYS[role]]) || 15_000;
  return AbortSignal.timeout(ms);
}
