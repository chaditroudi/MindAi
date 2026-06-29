import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import { Agent } from '@mastra/core/agent';

export type AgentRole = 'supervisor' | 'writer' | 'chart' | 'memory';

// ── Provider registry ──────────────────────────────────────────────────────────
// To add a new provider: one entry here, nothing else to change.
// Every provider that exposes an OpenAI-compatible endpoint works out of the box.

export interface ProviderConfig {
  baseURL:  string;
  defaults: Record<AgentRole, string>;
}

export const PROVIDERS: Record<string, ProviderConfig> = {
  groq: {
    baseURL:  'https://api.groq.com/openai/v1',
    defaults: {
      supervisor: 'meta-llama/llama-4-maverick-17b-128e-instruct',
      chart:      'meta-llama/llama-4-maverick-17b-128e-instruct',
      writer:     'llama-3.3-70b-specdec',
      memory:     'llama-3.1-8b-instant',
    },
  },
  openai: {
    baseURL:  'https://api.openai.com/v1',
    defaults: {
      supervisor: 'gpt-4.1',
      chart:      'gpt-4.1',
      writer:     'gpt-4.1-mini',
      memory:     'gpt-4.1-mini',
    },
  },
  google: {
    baseURL:  'https://generativelanguage.googleapis.com/v1beta/openai',
    defaults: {
      supervisor: 'gemini-2.5-flash',
      chart:      'gemini-2.5-flash',
      writer:     'gemini-2.5-flash',
      memory:     'gemini-2.5-flash-lite-preview',
    },
  },
  anthropic: {
    baseURL:  'https://api.anthropic.com/v1',
    defaults: {
      supervisor: 'claude-sonnet-4-6',
      chart:      'claude-sonnet-4-6',
      writer:     'claude-haiku-4-5-20251001',
      memory:     'claude-haiku-4-5-20251001',
    },
  },
  mistral: {
    baseURL:  'https://api.mistral.ai/v1',
    defaults: {
      supervisor: 'mistral-large-latest',
      chart:      'mistral-large-latest',
      writer:     'mistral-small-latest',
      memory:     'mistral-small-latest',
    },
  },
  together: {
    baseURL:  'https://api.together.xyz/v1',
    defaults: {
      supervisor: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      chart:      'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      writer:     'meta-llama/Llama-3.1-8B-Instruct-Turbo',
      memory:     'meta-llama/Llama-3.1-8B-Instruct-Turbo',
    },
  },
  perplexity: {
    baseURL:  'https://api.perplexity.ai',
    defaults: {
      supervisor: 'llama-3.1-sonar-large-128k-online',
      chart:      'llama-3.1-sonar-large-128k-online',
      writer:     'llama-3.1-sonar-small-128k-online',
      memory:     'llama-3.1-sonar-small-128k-online',
    },
  },
};

// ── Role → env key for optional model name overrides ─────────────────────────

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

// ── Provider detection from API key prefix ────────────────────────────────────

export function detectProvider(apiKey: string): string {
  if (apiKey.startsWith('sk-ant-')) return 'anthropic';
  if (apiKey.startsWith('AIza'))   return 'google';
  if (apiKey.startsWith('sk-'))    return 'openai';
  return 'groq';
}

// ── Single model resolver — one createOpenAI call for every provider ──────────

export function resolveModel(
  role:          AgentRole,
  apiKey?:       string,
  userModel?:    string,
  userProvider?: string,
): LanguageModel {
  const key      = apiKey ?? process.env['GROQ_API_KEY'] ?? process.env['OPENAI_API_KEY'] ?? '';
  const provider = userProvider ?? detectProvider(key);
  const cfg      = PROVIDERS[provider];
  const model    = userModel
    ?? process.env[ROLE_ENV_KEYS[role]]?.trim()
    ?? cfg?.defaults[role]
    ?? 'gpt-4o-mini';

  return createOpenAI({
    apiKey:        key,
    baseURL:       cfg?.baseURL,
    compatibility: 'compatible',
  })(model);
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
