import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
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

// ── Dynamic model list fetcher ────────────────────────────────────────────────

export async function fetchProviderModels(
  provider: string,
  apiKey:   string,
): Promise<{ id: string; label: string }[]> {
  const request = buildProviderValidationRequest(provider, apiKey);
  if (!request) return [];

  const res = await fetch(request.url, {
    headers: request.headers,
    signal:  AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Provider returned ${res.status} when listing models.`);

  const json = await res.json() as unknown;
  const norm = normalizeProvider(provider);

  if (norm === 'google') {
    type GoogleModel = { name: string; displayName?: string; supportedGenerationMethods?: string[] };
    const list = (json as { models?: GoogleModel[] }).models ?? [];
    return list
      .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .map(m => ({
        id:    m.name.replace(/^models\//, ''),
        label: m.displayName ?? m.name.replace(/^models\//, ''),
      }));
  }

  if (norm === 'anthropic') {
    type AnthropicModel = { id: string; display_name?: string };
    const list = (json as { data?: AnthropicModel[] }).data ?? [];
    return list.map(m => ({ id: m.id, label: m.display_name ?? m.id }));
  }

  // OpenAI-compatible: Groq, OpenAI, Mistral, Together, Perplexity
  type OAIModel = { id: string };
  const list: OAIModel[] = (json as { data?: OAIModel[] }).data
    ?? (Array.isArray(json) ? (json as OAIModel[]) : []);
  return list
    .filter(m => m.id && typeof m.id === 'string')
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(m => ({ id: m.id, label: m.id }));
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

  if (!provider) {
    throw new Error(
      `No provider configured for role "${role}". ` +
      `Please select a provider in Settings.`,
    );
  }

  const baseURL = PROVIDERS[provider];

  if (!userModel) {
    throw new Error(
      `No model configured for role "${role}" (provider: ${provider}). ` +
      `Please select a model in Settings.`,
    );
  }

  switch (provider) {
    case 'anthropic':
      // Uses Anthropic's native SDK — different API format from OpenAI
      return createAnthropic({ apiKey: key })(userModel);
    case 'google':
      // Uses Google's native SDK — hits generateContent, not chat/completions or responses
      return createGoogleGenerativeAI({ apiKey: key, baseURL })(userModel);
    case 'groq':
      return createGroq({ apiKey: key, baseURL })(userModel);
    case 'openai':
    case 'mistral':
    case 'together':
    case 'perplexity':
      // .chat() forces Chat Completions endpoint (/chat/completions)
      // Without it, @ai-sdk/openai v2 defaults to the Responses API (/responses)
      // which these providers do not support.
      return createOpenAI({ apiKey: key, baseURL }).chat(userModel);
    default:
      if (!baseURL) {
        throw new Error(
          `Unsupported provider "${provider}". Supported: ${Object.keys(PROVIDERS).join(', ')}.`,
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
  const prov = normalizeProvider(userProvider) ?? detectProvider(apiKey?.trim() ?? '');
  return new Agent({
    id:           role,
    name:         role,
    instructions,
    model:        resolveModel(role, apiKey, userModel, userProvider),
    // Groq's json_schema strict mode rejects open schemas (z.record/additionalProperties).
    // json_object mode is fully compatible and Zod validates the structure client-side.
    providerOptions: prov === 'groq' ? { groq: { structuredOutputs: false } } : undefined,
  });
}
