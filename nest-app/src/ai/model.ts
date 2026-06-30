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

// ── Static model registry ──────────────────────────────────────────────────────
// Curated per-provider model lists returned by GET/POST /api/settings/models.
// No network call — add or remove entries here as providers release new models.

export const PROVIDER_MODELS: Record<string, { id: string; label: string }[]> = {
  openai: [
    { id: 'gpt-4o',              label: 'GPT-4o' },
    { id: 'gpt-4o-mini',         label: 'GPT-4o Mini' },
    { id: 'gpt-4-turbo',         label: 'GPT-4 Turbo' },
    { id: 'o1',                  label: 'o1' },
    { id: 'o1-mini',             label: 'o1 Mini' },
    { id: 'o3',                  label: 'o3' },
    { id: 'o3-mini',             label: 'o3 Mini' },
  ],
  anthropic: [
    { id: 'claude-opus-4-8',              label: 'Claude Opus 4.8' },
    { id: 'claude-sonnet-4-6',            label: 'Claude Sonnet 4.6' },
    { id: 'claude-haiku-4-5-20251001',    label: 'Claude Haiku 4.5' },
    { id: 'claude-3-5-sonnet-20241022',   label: 'Claude 3.5 Sonnet' },
    { id: 'claude-3-5-haiku-20241022',    label: 'Claude 3.5 Haiku' },
    { id: 'claude-3-opus-20240229',       label: 'Claude 3 Opus' },
  ],
  google: [
    { id: 'gemini-2.5-pro',    label: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash',  label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.0-flash',  label: 'Gemini 2.0 Flash' },
    { id: 'gemini-1.5-pro',    label: 'Gemini 1.5 Pro' },
    { id: 'gemini-1.5-flash',  label: 'Gemini 1.5 Flash' },
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile',  label: 'Llama 3.3 70B Versatile' },
    { id: 'llama-3.1-70b-versatile',  label: 'Llama 3.1 70B Versatile' },
    { id: 'llama-3.1-8b-instant',     label: 'Llama 3.1 8B Instant' },
    { id: 'mixtral-8x7b-32768',       label: 'Mixtral 8x7B' },
    { id: 'gemma2-9b-it',             label: 'Gemma 2 9B' },
  ],
  mistral: [
    { id: 'mistral-large-latest',   label: 'Mistral Large' },
    { id: 'mistral-medium-latest',  label: 'Mistral Medium' },
    { id: 'mistral-small-latest',   label: 'Mistral Small' },
    { id: 'codestral-latest',       label: 'Codestral' },
    { id: 'open-mistral-nemo',      label: 'Mistral Nemo' },
  ],
  together: [
    { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',  label: 'Llama 3.3 70B Turbo' },
    { id: 'meta-llama/Llama-3.1-70B-Instruct-Turbo',  label: 'Llama 3.1 70B Turbo' },
    { id: 'meta-llama/Llama-3.1-8B-Instruct-Turbo',   label: 'Llama 3.1 8B Turbo' },
    { id: 'mistralai/Mixtral-8x7B-Instruct-v0.1',     label: 'Mixtral 8x7B' },
    { id: 'Qwen/Qwen2.5-72B-Instruct-Turbo',          label: 'Qwen 2.5 72B Turbo' },
  ],
  perplexity: [
    { id: 'sonar-pro',            label: 'Sonar Pro' },
    { id: 'sonar',                label: 'Sonar' },
    { id: 'sonar-reasoning-pro',  label: 'Sonar Reasoning Pro' },
    { id: 'sonar-reasoning',      label: 'Sonar Reasoning' },
  ],
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

// ── OpenAI-compat fetch interceptor ──────────────────────────────────────────
// @ai-sdk/openai v2 derives systemMessageMode from the model ID: any non-GPT
// model name is classified as a "reasoning model" and gets role:"developer".
// Mistral, Together, Perplexity reject that with 422. This fetch wrapper converts
// role:"developer" → role:"system" in the serialised request body before sending.

async function openAICompatFetch(
  input:   RequestInfo | URL,
  init?:   RequestInit,
): Promise<Response> {
  if (init?.body && typeof init.body === 'string') {
    try {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      if (Array.isArray(body['messages'])) {
        body['messages'] = (body['messages'] as Array<Record<string, unknown>>).map(m =>
          m['role'] === 'developer' ? { ...m, role: 'system' } : m,
        );
        init = { ...init, body: JSON.stringify(body) };
      }
    } catch {
      // body not JSON — pass through unchanged
    }
  }
  return fetch(input as Parameters<typeof fetch>[0], init);
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
  const model    = userModel?.trim();

  if (!key) {
    throw new Error(
      `No API key configured for role "${role}". ` +
      `Please add one in Settings or Agent Config.`,
    );
  }

  if (!provider) {
    throw new Error(
      `No provider configured for role "${role}". ` +
      `Please select a provider in Settings.`,
    );
  }

  const baseURL = PROVIDERS[provider];

  if (!model) {
    throw new Error(
      `No model configured for role "${role}" (provider: ${provider}). ` +
      `Please select a model in Settings.`,
    );
  }

  switch (provider) {
    case 'anthropic':
      return createAnthropic({ apiKey: key })(model);
    case 'google':
      return createGoogleGenerativeAI({ apiKey: key, baseURL })(model);
    case 'groq':
      return createGroq({ apiKey: key, baseURL })(model);
    case 'openai':
      return createOpenAI({ apiKey: key, baseURL }).chat(model);
    case 'mistral':
    case 'together':
    case 'perplexity':
      return createOpenAI({ apiKey: key, baseURL, fetch: openAICompatFetch }).chat(model);
    default:
      if (!baseURL) {
        throw new Error(
          `Unsupported provider "${provider}". Supported: ${Object.keys(PROVIDERS).join(', ')}.`,
        );
      }
      return createOpenAI({ apiKey: key, baseURL, fetch: openAICompatFetch }).chat(model);
  }
}

export function freshSignal(_role: AgentRole, timeoutMs?: number): AbortSignal | undefined {
  const ms = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.round(timeoutMs)
    : undefined;
  return ms ? AbortSignal.timeout(ms) : undefined;
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

/**
 * Returns provider-specific options for agent.generate() calls.
 * Groq's json_schema strict mode rejects open schemas (z.record / additionalProperties).
 * Setting structuredOutputs:false uses json_object mode instead — valid JSON is still
 * required and Zod validates the shape on our side.
 */
// OpenAI-compat providers (via createOpenAI) that only accept role:"system",
// not the newer OpenAI-specific role:"developer".
const OPENAI_COMPAT_SYSTEM_ROLE = new Set(['mistral', 'together', 'perplexity']);

export function skillProviderOptions(
  apiKey?:       string,
  userProvider?: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const prov = normalizeProvider(userProvider) ?? detectProvider(apiKey?.trim() ?? '');
  if (!prov) return undefined;

  const opts: Record<string, unknown> = {};

  // Groq's json_schema strict mode rejects open schemas — use json_object mode instead.
  if (prov === 'groq') opts['groq'] = { structuredOutputs: false };

  // Mistral, Together, Perplexity (and other OpenAI-compat providers) only accept
  // role:"system". The @ai-sdk/openai v2 provider defaults to role:"developer" for
  // some models, which these providers reject with 422 Unprocessable Entity.
  if (OPENAI_COMPAT_SYSTEM_ROLE.has(prov)) opts['openai'] = { systemMessageMode: 'system' };

  return Object.keys(opts).length ? opts : undefined;
}
