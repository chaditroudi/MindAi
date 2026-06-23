import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModelV1 } from 'ai';

export type AgentRole  = 'supervisor' | 'writer' | 'chart' | 'memory';
export type AIProvider = 'groq' | 'openai';

const ROLE_ENV_KEYS: Record<AgentRole, string> = {
  supervisor: 'GROQ_SUPERVISOR_MODEL',
  chart:      'GROQ_CHART_MODEL',
  writer:     'GROQ_WRITER_MODEL',
  memory:     'GROQ_MEMORY_MODEL',
};

const ROLE_DEFAULTS: Record<AgentRole, string> = {
  supervisor: 'llama-3.3-70b-versatile',
  chart:      'llama-3.3-70b-versatile',
  writer:     'llama-3.3-70b-versatile',
  memory:     'llama-3.1-8b-instant',
};

const OPENAI_DEFAULTS: Record<AgentRole, string> = {
  supervisor: 'gpt-4o-mini',
  chart:      'gpt-4o-mini',
  writer:     'gpt-4o-mini',
  memory:     'gpt-4o-mini',
};

const TIMEOUT_ENV_KEYS: Record<AgentRole, string> = {
  supervisor: 'SUPERVISOR_TIMEOUT_MS',
  chart:      'CHART_TIMEOUT_MS',
  writer:     'WRITER_TIMEOUT_MS',
  memory:     'WRITER_TIMEOUT_MS',
};

export function detectProvider(apiKey: string): AIProvider {
  return apiKey.startsWith('sk-') ? 'openai' : 'groq';
}

export function resolveModel(role: AgentRole, apiKey?: string): LanguageModelV1 {
  const key      = apiKey ?? process.env['GROQ_API_KEY'] ?? process.env['OPENAI_API_KEY'] ?? '';
  const provider = detectProvider(key);
  const override = process.env[ROLE_ENV_KEYS[role]]?.trim();

  if (provider === 'openai') {
    return createOpenAI({ apiKey: key })(override ?? OPENAI_DEFAULTS[role]);
  }

  return createOpenAI({
    baseURL:       'https://api.groq.com/openai/v1',
    apiKey:        key,
    compatibility: 'compatible',
  })(override ?? ROLE_DEFAULTS[role]);
}

export function freshSignal(role: AgentRole): AbortSignal {
  const ms = Number(process.env[TIMEOUT_ENV_KEYS[role]]) || 8_000;
  return AbortSignal.timeout(ms);
}
