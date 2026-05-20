import { createOpenAI } from '@ai-sdk/openai';

type AgentRole = 'supervisor' | 'mongodb' | 'search' | 'writer' | 'chart';

const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-4.1-mini';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

const MODEL_ENV_BY_ROLE: Record<AgentRole, string> = {
  supervisor: 'OPENROUTER_SUPERVISOR_MODEL',
  mongodb: 'OPENROUTER_MONGODB_MODEL',
  search: 'OPENROUTER_SEARCH_MODEL',
  writer: 'OPENROUTER_WRITER_MODEL',
  chart: 'OPENROUTER_CHART_MODEL',
};

export function resolveModel(role: AgentRole) {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();

  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is missing in .env.');
  }

  const modelName =
    process.env[MODEL_ENV_BY_ROLE[role]]?.trim() ||
    process.env.OPENROUTER_MODEL?.trim() ||
    DEFAULT_OPENROUTER_MODEL;
  const headers: Record<string, string> = {};
  const openRouterSiteUrl = process.env.OPENROUTER_SITE_URL?.trim();
  const openRouterAppName = process.env.OPENROUTER_APP_NAME?.trim();

  if (openRouterSiteUrl) {
    headers['HTTP-Referer'] = openRouterSiteUrl;
  }

  if (openRouterAppName) {
    headers['X-OpenRouter-Title'] = openRouterAppName;
  }

  const openrouter = createOpenAI({
    name: 'openrouter',
    baseURL: OPENROUTER_BASE_URL,
    apiKey,
    compatibility: 'compatible',
    headers,
  });
  return openrouter(modelName);
}
