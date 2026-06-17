import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModelV1 } from 'ai';

export type AgentRole = 'supervisor' | 'writer' | 'chart';

const ROLE_DEFAULTS: Record<AgentRole, string> = {
  supervisor: 'llama-3.3-70b-versatile',
  chart:      'llama-3.1-8b-instant',
  writer:     'llama-3.1-8b-instant',
};

export function resolveModel(role: AgentRole, apiKey?: string): LanguageModelV1 {
  const key = apiKey ?? process.env['GROQ_API_KEY'] ?? '';
  const groq = createOpenAI({
    baseURL:       'https://api.groq.com/openai/v1',
    apiKey:        key,
    compatibility: 'compatible',
  });
  const name = process.env[`GROQ_${role.toUpperCase()}_MODEL`]?.trim() ?? ROLE_DEFAULTS[role];
  return groq(name);
}

export function freshSignal(role: AgentRole): AbortSignal {
  const envKey = `${role.toUpperCase()}_TIMEOUT_MS`;
  const ms = Number(process.env[envKey]) || 8_000;
  return AbortSignal.timeout(ms);
}
