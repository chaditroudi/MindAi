import { createOpenAI } from '@ai-sdk/openai';

type AgentRole = 'supervisor' | 'writer' | 'chart' | 'search';
type ModelProvider = 'openrouter' | 'groq';

const DEFAULT_OPENROUTER_MODEL = 'meta-llama/llama-3.3-70b-instruct:free';
const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';

const OPENROUTER_MODEL_ENV: Record<AgentRole, string> = {
  supervisor: 'OPENROUTER_SUPERVISOR_MODEL',
  writer: 'OPENROUTER_WRITER_MODEL',
  chart: 'OPENROUTER_CHART_MODEL',
  search: 'OPENROUTER_SEARCH_MODEL',
};

const GROQ_MODEL_ENV: Record<AgentRole, string> = {
  supervisor: 'GROQ_SUPERVISOR_MODEL',
  writer: 'GROQ_WRITER_MODEL',
  chart: 'GROQ_CHART_MODEL',
  search: 'GROQ_SEARCH_MODEL',
};

export function resolveModel(role: AgentRole) {
  const provider = resolveProvider();
  return provider === 'groq' ? resolveGroqModel(role) : resolveOpenRouterModel(role);
}

export function hasModelProviderConfigured() {
  try {
    const provider = resolveProvider();
    return provider === 'openrouter'
      ? Boolean(process.env.OPENROUTER_API_KEY?.trim())
      : Boolean(process.env.GROQ_API_KEY?.trim());
  } catch {
    return false;
  }
}

function resolveProvider(): ModelProvider {
  const raw = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (!raw || raw === 'openrouter') return 'openrouter';
  if (raw === 'groq') return 'groq';
  throw new Error(`Unsupported LLM_PROVIDER "${raw}". Use "openrouter" or "groq".`);
}

function resolveOpenRouterModel(role: AgentRole) {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is missing. Set LLM_PROVIDER=groq to use Groq instead.');

  const modelName =
    process.env[OPENROUTER_MODEL_ENV[role]]?.trim() ||
    process.env.OPENROUTER_MODEL?.trim() ||
    DEFAULT_OPENROUTER_MODEL;

  return createOpenAI({ name: 'openrouter', baseURL: 'https://openrouter.ai/api/v1', apiKey, compatibility: 'compatible' })(modelName);
}

function resolveGroqModel(role: AgentRole) {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new Error('GROQ_API_KEY is missing. Set LLM_PROVIDER=openrouter to use OpenRouter instead.');

  const modelName =
    process.env[GROQ_MODEL_ENV[role]]?.trim() ||
    process.env.GROQ_MODEL?.trim() ||
    DEFAULT_GROQ_MODEL;

  return createOpenAI({ name: 'groq', baseURL: 'https://api.groq.com/openai/v1', apiKey, compatibility: 'compatible' })(modelName);
}
