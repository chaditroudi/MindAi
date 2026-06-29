import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import { Agent } from '@mastra/core/agent';

export type AgentRole = 'supervisor' | 'writer' | 'chart' | 'memory';

type ProviderName = keyof typeof PROVIDERS;

// ── Provider registry ──────────────────────────────────────────────────────────
// Maps provider slug → OpenAI-compatible Chat Completions base URL.
// All non-Anthropic providers are accessed via the OpenAI-compat API.
// Google's OpenAI-compat path requires the /openai suffix on the base URL.

export const PROVIDERS: Record<string, string> = {
  groq:       'https://api.groq.com/openai/v1',
  openai:     'https://api.openai.com/v1',
  google:     'https://generativelanguage.googleapis.com/v1beta',
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

export function detectProviderFromApiKey(apiKey: string): ProviderName | null {
  if (apiKey.startsWith('gsk_'))    return 'groq';
  if (apiKey.startsWith('sk-ant-')) return 'anthropic';
  if (apiKey.startsWith('AIza'))    return 'google';
  if (apiKey.startsWith('sk-'))     return 'openai';
  return null;
}

// Returns null when the key prefix doesn't match — no silent groq fallback.
export function detectProvider(apiKey: string): string | null {
  return detectProviderFromApiKey(apiKey);
}

function normalizeProvider(provider?: string): string | undefined {
  const normalized = provider?.trim().toLowerCase();
  return normalized || undefined;
}

export function buildProviderValidationRequest(
  provider: string,
  apiKey: string,
): { url: string; headers: Record<string, string> } | null {
  const normalized = normalizeProvider(provider);
  if (!normalized) return null;

  const baseURL = PROVIDERS[normalized];
  if (!baseURL) return null;

  if (normalized === 'google') {
    return {
      url:     `${baseURL}/models`,
      headers: { 'x-goog-api-key': apiKey },
    };
  }

  if (normalized === 'anthropic') {
    return {
      url: `${baseURL}/models`,
      headers: {
        'anthropic-version': '2023-06-01',
        'x-api-key':         apiKey,
      },
    };
  }

  return {
    url:     `${baseURL}/models`,
    headers: { Authorization: `Bearer ${apiKey}` },
  };
}

// ── Model resolver ────────────────────────────────────────────────────────────

export function resolveModel(
  role:          AgentRole,
  apiKey?:       string,
  userModel?:    string,
  userProvider?: string,
): LanguageModel {
  const key      = apiKey?.trim() ?? '';
  const provider = normalizeProvider(userProvider) ?? detectProvider(key);
  const baseURL  = PROVIDERS[provider];

  if (!userModel) {
    throw new Error(
      `No model configured for role "${role}" (provider: ${provider}). ` +
      `Please select a model in Settings.`,
    );
  }

  switch (provider) {
    case 'anthropic':
      return createAnthropic({ apiKey: key, baseURL })(userModel);
    case 'google':
      return createGoogleGenerativeAI({ apiKey: key, baseURL })(userModel);
    case 'groq':
      return createGroq({ apiKey: key, baseURL })(userModel);
    case 'openai':
      return createOpenAI({ apiKey: key, baseURL })(userModel);
    case 'mistral':
    case 'together':
    case 'perplexity':
      return createOpenAI({ apiKey: key, baseURL }).chat(userModel);
    default:
      if (!baseURL) {
        throw new Error(
          `Unsupported provider "${provider}". Supported providers: ${Object.keys(PROVIDERS).join(', ')}.`,
        );
      }
      return createOpenAI({ apiKey: key, baseURL }).chat(userModel);
  }
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
