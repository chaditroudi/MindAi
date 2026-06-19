import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModelV1 } from 'ai';

export type AgentRole = 'supervisor' | 'writer' | 'chart' | 'memory';



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

export function modelName(role: AgentRole): string {
  return process.env[ROLE_ENV_KEYS[role]]?.trim() ?? ROLE_DEFAULTS[role];
}
