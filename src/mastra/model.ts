import { createOpenAI } from '@ai-sdk/openai';

type AgentRole = 'supervisor' | 'mongodb' | 'search' | 'writer' | 'chart';
type ModelProvider = 'ollama' | 'groq';

const DEFAULT_OLLAMA_MODEL = 'gpt-oss:20b';
const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434/v1';
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';

const OLLAMA_MODEL_ENV_BY_ROLE: Record<AgentRole, string> = {
  supervisor: 'OLLAMA_SUPERVISOR_MODEL',
  mongodb: 'OLLAMA_MONGODB_MODEL',
  search: 'OLLAMA_SEARCH_MODEL',
  writer: 'OLLAMA_WRITER_MODEL',
  chart: 'OLLAMA_CHART_MODEL',
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

  return resolveOllamaModel(role);
}

export function hasModelProviderConfigured() {
  return resolveProvider() === 'ollama' || Boolean(process.env.GROQ_API_KEY?.trim());
}

function resolveProvider(): ModelProvider {
  const raw = process.env.LLM_PROVIDER?.trim().toLowerCase();
  return raw === 'groq' ? 'groq' : 'ollama';
}

function resolveOllamaModel(role: AgentRole) {
  const modelName =
    process.env[OLLAMA_MODEL_ENV_BY_ROLE[role]]?.trim() ||
    process.env.OLLAMA_MODEL?.trim() ||
    DEFAULT_OLLAMA_MODEL;

  const ollama = createOpenAI({
    name: 'ollama',
    baseURL: process.env.OLLAMA_BASE_URL?.trim() || DEFAULT_OLLAMA_BASE_URL,
    apiKey: process.env.OLLAMA_API_KEY?.trim() || 'ollama',
    compatibility: 'compatible',
  });
  return ollama(modelName);
}

function resolveGroqModel(role: AgentRole) {
  const apiKey = process.env.GROQ_API_KEY?.trim();

  if (!apiKey) {
    throw new Error('GROQ_API_KEY is missing in .env. Set LLM_PROVIDER=ollama to use Ollama instead.');
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
