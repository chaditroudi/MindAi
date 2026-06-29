import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import { Agent } from '@mastra/core/agent';

export type AgentRole = 'supervisor' | 'writer' | 'chart' | 'memory';

// ── Provider registry ──────────────────────────────────────────────────────────
// Maps provider slug → OpenAI-compatible base URL.
// Model names come entirely from the user's UI (settings / agent config) — no defaults here.
// To add a provider: one line below, nothing else to change.

export const PROVIDERS: Record<string, string> = {
  groq:       'https://api.groq.com/openai/v1',
  openai:     'https://api.openai.com/v1',
  google:     'https://generativelanguage.googleapis.com/v1beta/openai',
  anthropic:  'https://api.anthropic.com/v1',
  mistral:    'https://api.mistral.ai/v1',
  together:   'https://api.together.xyz/v1',
  perplexity: 'https://api.perplexity.ai',
};

const TIMEOUT_ENV_KEYS: Record<AgentRole, string> = {
  supervisor: 'SUPERVISOR_TIMEOUT_MS',
  chart:      'CHART_TIMEOUT_MS',
  writer:     'WRITER_TIMEOUT_MS',
  memory:     'WRITER_TIMEOUT_MS',
};

// ── Provider detection from API key prefix ────────────────────────────────────

export function detectProvider(apiKey: string): string {
  if (apiKey.startsWith('sk-ant-')) return 'anthropic';
  if (apiKey.startsWith('AIza'))   return 'google';
  if (apiKey.startsWith('sk-'))    return 'openai';
  return 'groq';
}

// ── Model resolver ────────────────────────────────────────────────────────────

export function resolveModel(
  role:          AgentRole,
  apiKey?:       string,
  userModel?:    string,
  userProvider?: string,
): LanguageModel {
  const key      = apiKey ?? '';
  const provider = userProvider ?? detectProvider(key);
  const baseURL  = PROVIDERS[provider];

  if (!userModel) {
    throw new Error(
      `No model configured for role "${role}" (provider: ${provider}). ` +
      `Please select a model in Settings.`,
    );
  }

  return createOpenAI({ apiKey: key, baseURL })(userModel);
}

export function freshSignal(role: AgentRole): AbortSignal {
  const ms = Number(process.env[TIMEOUT_ENV_KEYS[role]]) || 15_000;
  return AbortSignal.timeout(ms);
}

export function createSkillAgent(
  role:          AgentRole,
  instructions:  string,
  apiKey?:       string,
  userModel?:    string,
  userProvider?: string,
): Agent {
  return new Agent({
    id:           role,
    name:         role,
    instructions,
    model:        resolveModel(role, apiKey, userModel, userProvider),
  });
}
