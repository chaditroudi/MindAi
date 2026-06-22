// ── PURPOSE ───────────────────────────────────────────────────────────────────
// This file is the SINGLE PLACE that creates Groq LLM clients.
// Every LLM call in the app (planner, chart, writer, memory) uses the three
// functions exported here: resolveModel(), freshSignal(), modelName().
//
// WHY A SEPARATE FILE: keeps LLM configuration in one place. If we switch from
// Groq to another provider, we only change this file.
//
// USED BY: ai/planner.ts, ai/chart.ts, ai/writer.ts, ai/memory-skill.ts
// ─────────────────────────────────────────────────────────────────────────────

// createOpenAI → factory from the Vercel AI SDK that creates an OpenAI-compatible client.
// Groq exposes an OpenAI-compatible API, so we reuse this factory by pointing
// baseURL at Groq's endpoint instead of OpenAI's.
import { createOpenAI } from '@ai-sdk/openai';

// LanguageModelV1 → the Vercel AI SDK interface that generateObject() / generateText()
// accept. Our resolveModel() returns this type so callers don't depend on Groq specifics.
import type { LanguageModelV1 } from 'ai';

// Lookup tables defined in constants/Model.ts:
//   ROLE_ENV_KEYS    → maps role -> which env var overrides its model name
//   ROLE_DEFAULTS    → maps role -> default model name if no env var is set
//   TIMEOUT_ENV_KEYS → maps role -> which env var sets its timeout in ms
import { ROLE_ENV_KEYS, ROLE_DEFAULTS, OPENAI_DEFAULTS, TIMEOUT_ENV_KEYS } from 'src/constants/Model';

export type AgentRole = 'supervisor' | 'writer' | 'chart' | 'memory';

// Detect provider from key prefix: OpenAI keys start "sk-", Groq keys start "gsk_"
export type AIProvider = 'groq' | 'openai';
export function detectProvider(apiKey: string): AIProvider {
  return apiKey.startsWith('sk-') ? 'openai' : 'groq';
}


// ── resolveModel() ────────────────────────────────────────────────────────────
// Creates and returns a ready-to-use Groq LLM client for the given role.
//
// @param role    - which AI role this call is for (determines model name)
// @param apiKey  - optional per-request API key (user's own key overrides global)
//
// HOW MODEL SELECTION WORKS (priority order):
//   1. Env var override  e.g. GROQ_SUPERVISOR_MODEL=llama-3.1-70b-specdec
//   2. ROLE_DEFAULTS     e.g. 'llama-3.3-70b-versatile' for supervisor/chart/writer
//
// HOW API KEY SELECTION WORKS (priority order):
//   1. apiKey parameter  (per-user key passed at request time)
//   2. GROQ_API_KEY env  (global server key)
//   3. empty string      (will cause Groq to return 401 — handled by AnalyticsService)
export function resolveModel(role: AgentRole, apiKey?: string): LanguageModelV1 {
  const key = apiKey
    ?? process.env['GROQ_API_KEY']
    ?? process.env['OPENAI_API_KEY']
    ?? '';

  const provider = detectProvider(key);
  const envName  = process.env[ROLE_ENV_KEYS[role]]?.trim();

  if (provider === 'openai') {
    const client = createOpenAI({ apiKey: key });
    return client(envName ?? OPENAI_DEFAULTS[role]);
  }

  // Groq uses the OpenAI-compatible endpoint with compatibility mode
  const groq = createOpenAI({
    baseURL:       'https://api.groq.com/openai/v1',
    apiKey:        key,
    compatibility: 'compatible',
  });
  return groq(envName ?? ROLE_DEFAULTS[role]);
}

// ── freshSignal() ─────────────────────────────────────────────────────────────
// Creates a NEW AbortSignal with a timeout for the given role.
// Called immediately before every LLM call to enforce a per-role time limit.
//
// WHY "fresh": AbortSignal.timeout() starts counting immediately when created.
// A reused signal could already be expired before the LLM call begins.
// Calling freshSignal() each time guarantees the full timeout is available.
//
// If the LLM does not respond within the timeout, the request is cancelled
// and an AbortError is thrown — caught and handled by the calling function.
export function freshSignal(role: AgentRole): AbortSignal {
  // Read timeout from env (e.g. SUPERVISOR_TIMEOUT_MS=8000), default to 8 seconds
  const ms = Number(process.env[TIMEOUT_ENV_KEYS[role]]) || 8_000;
  return AbortSignal.timeout(ms); // built-in Web API — no library needed
}

// ── modelName() ──────────────────────────────────────────────────────────────
// Returns just the model name string for the given role (used for logging only).
// Does NOT create a client — purely informational.
export function modelName(role: AgentRole): string {
  return process.env[ROLE_ENV_KEYS[role]]?.trim() ?? ROLE_DEFAULTS[role];
}
