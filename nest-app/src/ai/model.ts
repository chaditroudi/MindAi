import { createOpenAI }              from '@ai-sdk/openai';
import { createAnthropic }           from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI }  from '@ai-sdk/google';
import type { LanguageModel }        from 'ai';
import { Agent }                     from '@mastra/core/agent';

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
    supervisor: 'meta-llama/llama-4-maverick-17b-128e-instruct',
    chart:      'meta-llama/llama-4-maverick-17b-128e-instruct',
    writer:     'llama-3.3-70b-specdec',
    memory:     'llama-3.1-8b-instant',
  },
  openai: {
    supervisor: 'gpt-4.1',
    chart:      'gpt-4.1',
    writer:     'gpt-4.1-mini',
    memory:     'gpt-4.1-mini',
  },
  anthropic: {
    supervisor: 'claude-sonnet-4-6',
    chart:      'claude-sonnet-4-6',
    writer:     'claude-haiku-4-5-20251001',
    memory:     'claude-haiku-4-5-20251001',
  },
  google: {
    supervisor: 'gemini-2.5-flash',
    chart:      'gemini-2.5-flash',
    writer:     'gemini-2.5-flash',
    memory:     'gemini-2.5-flash-lite-preview',
  },
};

export function detectProvider(apiKey: string): AIProvider {
  if (apiKey.startsWith('sk-ant-')) return 'anthropic';
  if (apiKey.startsWith('AIza'))   return 'google';
  if (apiKey.startsWith('sk-'))    return 'openai';
  return 'groq';
}

export function resolveModel(role: AgentRole, apiKey?: string, userModel?: string, userProvider?: string): LanguageModel {
  const key      = apiKey ?? process.env['GROQ_API_KEY'] ?? process.env['OPENAI_API_KEY'] ?? '';
  const provider = (userProvider as AIProvider | undefined) ?? detectProvider(key);
  const model    = userModel ?? process.env[ROLE_ENV_KEYS[role]]?.trim() ?? PROVIDER_DEFAULTS[provider][role];

  switch (provider) {
    case 'anthropic':
      return createAnthropic({ apiKey: key })(model);
    case 'google':
      return createGoogleGenerativeAI({ apiKey: key })(model);
    case 'openai':
      return createOpenAI({ apiKey: key }).chat(model);
    default:
      return createOpenAI({
        baseURL: 'https://api.groq.com/openai/v1',
        apiKey:  key,
      }).chat(model);
  }
}

export function freshSignal(role: AgentRole): AbortSignal {
  const ms = Number(process.env[TIMEOUT_ENV_KEYS[role]]) || 15_000;
  return AbortSignal.timeout(ms);
}

export function createSkillAgent(
  role: AgentRole,
  instructions: string,
  apiKey?: string,
  userModel?: string,
  userProvider?: string,
): Agent {
  return new Agent({
    id:           role,
    name:         role,
    instructions,
    model:        resolveModel(role, apiKey, userModel, userProvider),
  });
}
