import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModelV1 } from 'ai';
import { config } from '../config.js';

export type AgentRole = 'supervisor' | 'writer' | 'chart';

const ROLE_DEFAULTS: Record<AgentRole, string> = {
  supervisor: 'llama-3.3-70b-versatile', // needs actual reasoning for plan building
  chart:      'llama-3.1-8b-instant',    // just picking field names, 8b is plenty
  writer:     'llama-3.1-8b-instant',    // 8b is fine for summarization
};

export function resolveModel(role: AgentRole, apiKey?: string): LanguageModelV1 {
  const key = apiKey ?? config.llm.groqApiKey ?? '';
  const groq = createOpenAI({
    baseURL:       'https://api.groq.com/openai/v1',
    apiKey:        key,
    compatibility: 'compatible',
  });
  const name = process.env[`GROQ_${role.toUpperCase()}_MODEL`]?.trim()
    ?? ROLE_DEFAULTS[role];
  return groq(name);
}

export function freshSignal(role: AgentRole): AbortSignal {
  return AbortSignal.timeout(config.llm.timeouts[role]);
}
