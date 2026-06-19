import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModelV1 } from 'ai';

export type AgentRole = 'supervisor' | 'writer' | 'chart' | 'memory';

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
  memory:     'llama-3.3-70b-versatile',
};

const TIMEOUT_ENV_KEYS: Record<AgentRole, string> = {
  supervisor: 'SUPERVISOR_TIMEOUT_MS',
  chart:      'CHART_TIMEOUT_MS',
  writer:     'WRITER_TIMEOUT_MS',
  memory:     'WRITER_TIMEOUT_MS',
};

export function resolveModel(role: AgentRole, apiKey?: string): LanguageModelV1 {
  const key = apiKey ?? process.env['GROQ_API_KEY'] ?? '';
  const groq = createOpenAI({
    baseURL:       'https://api.groq.com/openai/v1',
    apiKey:        key,
    compatibility: 'compatible',
  });
  const name = process.env[ROLE_ENV_KEYS[role]]?.trim() ?? ROLE_DEFAULTS[role];
  return groq(name);
}

export function freshSignal(role: AgentRole): AbortSignal {
  const ms = Number(process.env[TIMEOUT_ENV_KEYS[role]]) || 8_000;
  return AbortSignal.timeout(ms);
}

/** Returns the model name that will be used for a given role (for logging/diagnostics). */
export function modelName(role: AgentRole): string {
  return process.env[ROLE_ENV_KEYS[role]]?.trim() ?? ROLE_DEFAULTS[role];
}
