import { createOpenAI } from '@ai-sdk/openai';

const DEFAULT_OPENROUTER_MODEL = 'meta-llama/llama-3.3-70b-instruct:free';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export function resolveModel() {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();

  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is missing in .env.');
  }

  const modelName = process.env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL;
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
