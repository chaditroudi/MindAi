import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import { Agent } from '@mastra/core/agent';

/**
 * model.ts
 * --------
 * The one place in the app that knows how to turn "a provider name + an API
 * key + a model id" into an actual callable LLM client. Every AI skill
 * (planner, chart, writer, memory) goes through createSkillAgent() here
 * rather than touching any @ai-sdk/* package directly.
 */

// Which of the 4 fixed skill roles is calling — used for error messages
// ("No API key configured for role 'chart'") and per-role request timeouts
// (freshSignal below), not for choosing the model itself (that's driven by
// the caller-supplied provider/model/key).
export type AgentRole = 'supervisor' | 'writer' | 'chart' | 'memory';

type ProviderName = keyof typeof PROVIDERS;

// ── Provider registry ──────────────────────────────────────────────────────────
// Maps provider slug → OpenAI-compatible Chat Completions base URL.
// All non-Anthropic providers are accessed via the OpenAI-compat API.
// Google's OpenAI-compat path requires the /openai suffix on the base URL.

/**
 * Every provider this app knows how to talk to. Used in three places: (1)
 * resolveModel below, to build the actual SDK client; (2)
 * buildProviderValidationRequest, to know what URL to ping for key
 * validation; (3) UserSettingsService, to reject an unrecognized provider
 * name outright before ever trying to use it.
 */
export const PROVIDERS: Record<string, string> = {
  groq: 'https://api.groq.com/openai/v1',
  openai: 'https://api.openai.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  anthropic: 'https://api.anthropic.com/v1',
  mistral: 'https://api.mistral.ai/v1',
  together: 'https://api.together.xyz/v1',
  perplexity: 'https://api.perplexity.ai',
};

// ── Static model registry ──────────────────────────────────────────────────────
// Curated per-provider model lists returned by GET/POST /api/settings/models.
// No network call — add or remove entries here as providers release new models.

/**
 * A hand-curated fallback list of known models per provider, shown in the
 * Settings UI's model picker. This is NOT what actually validates a chosen
 * model works — that's fetchProviderModels below, which hits the provider's
 * real live catalogue. This static list exists purely so the UI has
 * something reasonable to show before/without a live fetch.
 */
export const PROVIDER_MODELS: Record<string, { id: string; label: string }[]> =
  {
    openai: [
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
      { id: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
      { id: 'o1', label: 'o1' },
      { id: 'o1-mini', label: 'o1 Mini' },
      { id: 'o3', label: 'o3' },
      { id: 'o3-mini', label: 'o3 Mini' },
    ],
    anthropic: [
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
      { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
      { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
      { id: 'claude-3-opus-20240229', label: 'Claude 3 Opus' },
    ],
    google: [
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
      { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
      { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
    ],
    groq: [
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile' },
      { id: 'llama-3.1-70b-versatile', label: 'Llama 3.1 70B Versatile' },
      { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant' },
      { id: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B' },
      { id: 'gemma2-9b-it', label: 'Gemma 2 9B' },
    ],
    mistral: [
      { id: 'mistral-large-latest', label: 'Mistral Large' },
      { id: 'mistral-medium-latest', label: 'Mistral Medium' },
      { id: 'mistral-small-latest', label: 'Mistral Small' },
      { id: 'codestral-latest', label: 'Codestral' },
      { id: 'open-mistral-nemo', label: 'Mistral Nemo' },
    ],
    together: [
      {
        id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
        label: 'Llama 3.3 70B Turbo',
      },
      {
        id: 'meta-llama/Llama-3.1-70B-Instruct-Turbo',
        label: 'Llama 3.1 70B Turbo',
      },
      {
        id: 'meta-llama/Llama-3.1-8B-Instruct-Turbo',
        label: 'Llama 3.1 8B Turbo',
      },
      { id: 'mistralai/Mixtral-8x7B-Instruct-v0.1', label: 'Mixtral 8x7B' },
      { id: 'Qwen/Qwen2.5-72B-Instruct-Turbo', label: 'Qwen 2.5 72B Turbo' },
    ],
    perplexity: [
      { id: 'sonar-pro', label: 'Sonar Pro' },
      { id: 'sonar', label: 'Sonar' },
      { id: 'sonar-reasoning-pro', label: 'Sonar Reasoning Pro' },
      { id: 'sonar-reasoning', label: 'Sonar Reasoning' },
    ],
  };

// ── Provider detection from API key prefix ────────────────────────────────────
// Returns null when the key prefix doesn't match — no silent groq fallback.

/**
 * Guesses which provider a key belongs to purely from its prefix, used when
 * the caller didn't explicitly say which provider they mean (e.g.
 * skillProviderOptions, called with just an apiKey during structured-output
 * option resolution). Deliberately returns null rather than guessing wrong —
 * an unrecognized prefix (custom/self-hosted key formats) means "don't know,"
 * not "assume groq."
 */
function detectProvider(apiKey: string): ProviderName | null {
  if (apiKey.startsWith('gsk_')) return 'groq';
  if (apiKey.startsWith('sk-ant-')) return 'anthropic';
  if (apiKey.startsWith('AIza')) return 'google';
  if (apiKey.startsWith('sk-')) return 'openai';
  return null;
}

function normalizeProvider(provider?: string): string | undefined {
  const normalized = provider?.trim().toLowerCase();
  return normalized || undefined;
}

/**
 * Builds the request (URL + headers) needed to ask a provider "is this API
 * key valid, and what models can it use" — each provider authenticates
 * these read-only endpoints differently. Shared by three very different
 * call sites: UserSettingsService (validating a user's own key on save),
 * AgentHealthService (the per-minute pooled-agent liveness probe), and
 * fetchProviderModels below (populating the Settings model picker live).
 */
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
      url: `${baseURL}/models`,
      headers: { 'x-goog-api-key': apiKey },
    };
  }

  if (normalized === 'anthropic') {
    return {
      url: `${baseURL}/models`,
      headers: {
        'anthropic-version': '2023-06-01',
        'x-api-key': apiKey,
      },
    };
  }

  // Every other provider here is OpenAI-compatible and just wants a bearer token.
  return {
    url: `${baseURL}/models`,
    headers: { Authorization: `Bearer ${apiKey}` },
  };
}

// ── Dynamic model list fetcher ────────────────────────────────────────────────

/**
 * Hits the provider's real, live model catalogue (as opposed to the static
 * PROVIDER_MODELS fallback above) and returns a normalized id/label list.
 * Used by the Settings UI to show what models are ACTUALLY usable with the
 * key the user just entered, not just a hardcoded guess.
 */
export async function fetchProviderModels(
  provider: string,
  apiKey: string,
): Promise<{ id: string; label: string }[]> {
  const request = buildProviderValidationRequest(provider, apiKey);
  if (!request) return [];

  const res = await fetch(request.url, {
    headers: request.headers,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok)
    throw new Error(`Provider returned ${res.status} when listing models.`);

  const json = (await res.json()) as unknown;
  const norm = normalizeProvider(provider);

  if (norm === 'google') {
    type GoogleModel = {
      name: string;
      displayName?: string;
      supportedGenerationMethods?: string[];
    };
    const list = (json as { models?: GoogleModel[] }).models ?? [];
    // Google's catalogue includes embedding/vision-only models too — only
    // keep ones that actually support the chat-style generateContent call
    // this app makes.
    return list
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => ({
        id: m.name.replace(/^models\//, ''), // Google prefixes ids with "models/"
        label: m.displayName ?? m.name.replace(/^models\//, ''),
      }));
  }

  if (norm === 'anthropic') {
    type AnthropicModel = { id: string; display_name?: string };
    const list = (json as { data?: AnthropicModel[] }).data ?? [];
    return list.map((m) => ({ id: m.id, label: m.display_name ?? m.id }));
  }

  // OpenAI-compatible: Groq, OpenAI, Mistral, Together, Perplexity
  type OAIModel = { id: string };
  const list: OAIModel[] =
    (json as { data?: OAIModel[] })?.data ??
    // Some OpenAI-compat providers return a bare array instead of { data: [...] }
    (Array.isArray(json) ? (json as OAIModel[]) : []);
  return list
    .filter((m) => m.id && typeof m.id === 'string')
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((m) => ({ id: m.id, label: m.id }));
}

// ── OpenAI-compat fetch interceptor ──────────────────────────────────────────
// @ai-sdk/openai v2 derives systemMessageMode from the model ID: any non-GPT
// model name is classified as a "reasoning model" and gets role:"developer".
// Mistral, Together, Perplexity reject that with 422. This fetch wrapper converts
// role:"developer" → role:"system" in the serialised request body before sending.

/**
 * A drop-in replacement for global `fetch`, passed to createOpenAI() for the
 * OpenAI-compat providers (Mistral/Together/Perplexity/unlisted). Rewrites
 * any outgoing chat message with role:"developer" to role:"system" right
 * before the request leaves the process — see the comment block above for
 * why this is necessary. If the body isn't JSON (shouldn't happen for these
 * SDK calls, but defensively handled) it's passed through untouched.
 */
async function openAICompatFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (init?.body && typeof init.body === 'string') {
    try {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      if (Array.isArray(body['messages'])) {
        body['messages'] = (
          body['messages'] as Array<Record<string, unknown>>
        ).map((m) =>
          m['role'] === 'developer' ? { ...m, role: 'system' } : m,
        );
        init = { ...init, body: JSON.stringify(body) };
      }
    } catch {
      // body not JSON — pass through unchanged
    }
  }
  return fetch(input, init);
}

// ── Model resolver ────────────────────────────────────────────────────────────

/**
 * The actual provider→SDK-client dispatch. Every field is required to
 * resolve: no key/provider/model means an immediate, specific thrown error
 * rather than a confusing failure three layers deeper inside the AI SDK.
 * The three "unsupported provider" and "missing X" errors are what
 * AnalyticsService's error classification (isModelNotFoundError etc.) reacts
 * to, so their wording matters — don't casually reword them.
 */
function resolveModel(
  role: AgentRole,
  apiKey?: string,
  userModel?: string,
  userProvider?: string,
): LanguageModel {
  const key = apiKey?.trim() ?? '';
  // Explicit provider wins; otherwise fall back to guessing from the key's
  // prefix (covers callers — like plain skillProviderOptions usage — that
  // only have a key, not a provider name, at hand).
  const provider = normalizeProvider(userProvider) ?? detectProvider(key);
  const model = userModel?.trim();

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
      // OpenAI itself doesn't need the role-rewriting fetch wrapper — only
      // the OTHER OpenAI-compat providers below misinterpret "developer".
      return createOpenAI({ apiKey: key, baseURL }).chat(model);
    case 'mistral':
    case 'together':
    case 'perplexity':
      return createOpenAI({
        apiKey: key,
        baseURL,
        fetch: openAICompatFetch,
      }).chat(model);
    default:
      // An unrecognized provider string that's also not empty — e.g. a
      // custom self-hosted OpenAI-compatible endpoint someone typed in.
      // Only accepted if it has a registered baseURL; otherwise this is a
      // genuinely unsupported provider name and we say so explicitly.
      if (!baseURL) {
        throw new Error(
          `Unsupported provider "${provider}". Supported: ${Object.keys(PROVIDERS).join(', ')}.`,
        );
      }
      return createOpenAI({
        apiKey: key,
        baseURL,
        fetch: openAICompatFetch,
      }).chat(model);
  }
}

// ── Rate-limit retry wrapper ──────────────────────────────────────────────────
// Mastra's built-in p-retry doesn't honour the `retry-after` header on 429s,
// so we set maxRetries:0 in every agent.generate() call and handle retries here.

/** True only for an HTTP 429 specifically — other 4xx/5xx are handled elsewhere (AnalyticsService's error classifiers). */
function isRateLimitError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'statusCode' in err &&
    (err as { statusCode: number }).statusCode === 429
  );
}

/**
 * Distinguishes "wait a bit and try again" from "this key's quota is
 * genuinely exhausted for the day/month, retrying is pointless." Either an
 * explicit `x-should-retry: false` response header, or a computed wait time
 * so long (see MAX_RETRY_WAIT_MS) that it's clearly not a short-term
 * throttle.
 */
function isLongTermLimit(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const headers = (err as Record<string, unknown>)['responseHeaders'] as
    | Record<string, string>
    | undefined;
  if (headers?.['x-should-retry'] === 'false') return true;
  const waitMs = rateLimitDelayMs(err);
  return waitMs > MAX_RETRY_WAIT_MS;
}

// Waits longer than this are daily/weekly quota exhaustions — surface immediately.
const MAX_RETRY_WAIT_MS = 60_000;

/**
 * Figures out how long to actually wait before retrying a 429, preferring
 * the provider's own stated wait time over a guess:
 *  1. a `retry-after` header (seconds), plus 500ms buffer
 *  2. Anthropic/OpenAI-style `x-ratelimit-reset-tokens` (e.g. "12.5s")
 *  3. otherwise a flat 5-second guess
 */
function rateLimitDelayMs(err: unknown): number {
  if (typeof err === 'object' && err !== null) {
    const headers = (err as Record<string, unknown>)['responseHeaders'] as
      | Record<string, string>
      | undefined;
    if (headers) {
      const ra = headers['retry-after'];
      if (ra) {
        const secs = parseFloat(ra);
        if (Number.isFinite(secs) && secs > 0)
          return Math.ceil(secs * 1000) + 500;
      }
      const reset = headers['x-ratelimit-reset-tokens'];
      if (reset) {
        const m = reset.match(/^([\d.]+)s$/);
        if (m) return Math.ceil(parseFloat(m[1]) * 1000) + 500;
      }
    }
  }
  return 5_000;
}

/**
 * Wraps any async LLM call with real rate-limit backoff. This exists
 * specifically because Mastra's own internal retry mechanism ignores the
 * `retry-after` header entirely — every skill sets `maxRetries: 0` on its
 * own agent.generate() call and relies on THIS wrapper for all retry
 * behavior instead.
 *
 * On a genuine (non-long-term) 429, waits the computed delay and tries
 * again, up to `maxRetries` times. Any other error, or a long-term quota
 * exhaustion, is rethrown immediately without retrying — a fast failure the
 * caller (AnalyticsService/PipelineService) can classify and act on (e.g.
 * fail over to the next pooled agent).
 */
export async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRateLimitError(err) || attempt === maxRetries) throw err;
      // Daily/long-term quota — x-should-retry:false or very long wait. Surface immediately.
      if (isLongTermLimit(err)) throw err;
      const waitMs = rateLimitDelayMs(err);
      console.warn(
        `[${label}] rate limit — waiting ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`,
      );
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw lastError;
}

/**
 * Builds a per-call abort signal so a single hung LLM request can't block a
 * request indefinitely. `timeoutMs` is optional/undefined by most callers
 * today (no active per-role timeout configured) — passing 0 or a negative
 * number is treated the same as "no timeout" rather than an instant abort.
 */
export function freshSignal(
  _role: AgentRole,
  timeoutMs?: number,
): AbortSignal | undefined {
  const ms =
    typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
      ? Math.round(timeoutMs)
      : undefined;
  return ms ? AbortSignal.timeout(ms) : undefined;
}

/**
 * The one function every skill (planner/chart/writer/memory) calls to get a
 * usable Mastra Agent. A fresh Agent is created on every single call —
 * agents are cheap wrapper objects here, not pooled/reused connections, so
 * there's no lifecycle to manage or cache to invalidate when a user changes
 * their key/model mid-session.
 */
export function createSkillAgent(
  role: AgentRole,
  instructions: string,
  apiKey?: string,
  userModel?: string,
  userProvider?: string,
): Agent {
  return new Agent({
    id: role,
    name: role,
    instructions,
    model: resolveModel(role, apiKey, userModel, userProvider),
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
const OPENAI_COMPAT_SYSTEM_ROLE = new Set([
  'mistral',
  'together',
  'perplexity',
]);

/**
 * Per-provider quirks that have to be passed into agent.generate()'s own
 * `providerOptions`, as opposed to the request-body-level fix applied by
 * openAICompatFetch above (this handles the AI SDK's own structured-output
 * request shape, not the raw HTTP body). See the two comment blocks
 * immediately above for what each override is working around.
 */
export function skillProviderOptions(
  apiKey?: string,
  userProvider?: string,
): any {
  const prov =
    normalizeProvider(userProvider) ?? detectProvider(apiKey?.trim() ?? '');
  if (!prov) return undefined;

  const opts: Record<string, unknown> = {};

  // Groq's json_schema strict mode rejects open schemas — use json_object mode instead.
  if (prov === 'groq') opts['groq'] = { structuredOutputs: false };

  // Mistral, Together, Perplexity (and other OpenAI-compat providers) only accept
  // role:"system". The @ai-sdk/openai v2 provider defaults to role:"developer" for
  // some models, which these providers reject with 422 Unprocessable Entity.
  if (OPENAI_COMPAT_SYSTEM_ROLE.has(prov))
    opts['openai'] = { systemMessageMode: 'system' };

  return Object.keys(opts).length ? opts : undefined;
}
