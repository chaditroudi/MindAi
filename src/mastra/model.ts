import { createOpenAI } from '@ai-sdk/openai';

type AgentRole = 'supervisor' | 'mongodb' | 'search' | 'writer' | 'chart';
type ModelProvider = 'openrouter' | 'groq';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_OPENROUTER_MODEL = 'meta-llama/llama-3.3-70b-instruct:free';
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';

const OPENROUTER_MODEL_ENV_BY_ROLE: Record<AgentRole, string> = {
  supervisor: 'OPENROUTER_SUPERVISOR_MODEL',
  mongodb: 'OPENROUTER_MONGODB_MODEL',
  search: 'OPENROUTER_SEARCH_MODEL',
  writer: 'OPENROUTER_WRITER_MODEL',
  chart: 'OPENROUTER_CHART_MODEL',
};

const GROQ_MODEL_ENV_BY_ROLE: Record<AgentRole, string> = {
  supervisor: 'GROQ_SUPERVISOR_MODEL',
  mongodb: 'GROQ_MONGODB_MODEL',
  search: 'GROQ_SEARCH_MODEL',
  writer: 'GROQ_WRITER_MODEL',
  chart: 'GROQ_CHART_MODEL',
};

export function resolveModel(role: AgentRole) {
  const provider = resolveProvider();

  if (provider === 'groq') {
    return resolveGroqModel(role);
  }

  return resolveOpenRouterModel(role);
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

  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is missing in .env. Set LLM_PROVIDER=groq to use Groq instead.');
  }

  const modelName =
    process.env[OPENROUTER_MODEL_ENV_BY_ROLE[role]]?.trim() ||
    process.env.OPENROUTER_MODEL?.trim() ||
    DEFAULT_OPENROUTER_MODEL;

  const openrouter = createOpenAI({
    name: 'openrouter',
    baseURL: OPENROUTER_BASE_URL,
    apiKey,
    compatibility: 'compatible',
  });
  return openrouter(modelName);
}

function resolveGroqModel(role: AgentRole) {
  const apiKey = process.env.GROQ_API_KEY?.trim();

  if (!apiKey) {
    throw new Error('GROQ_API_KEY is missing in .env. Set LLM_PROVIDER=openrouter to use OpenRouter instead.');
  }

  const modelName =
    process.env[GROQ_MODEL_ENV_BY_ROLE[role]]?.trim() ||
    process.env.GROQ_MODEL?.trim() ||
    DEFAULT_GROQ_MODEL;

  const groq = createOpenAI({
    name: 'groq',
    baseURL: GROQ_BASE_URL,
    apiKey,
    compatibility: 'compatible',
  });
  return groq(modelName);
}
