import { createOpenAI } from '@ai-sdk/openai';

type AgentRole = 'supervisor' | 'writer' | 'chart' | 'search';
type ModelProvider = 'openrouter' | 'groq';

const PROVIDERS = {
  openrouter: {
    apiKeyEnv: 'OPENROUTER_API_KEY',
    fallbackEnv: 'OPENROUTER_MODEL',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    baseURL: 'https://openrouter.ai/api/v1',
    missingKeyMessage: 'OPENROUTER_API_KEY is missing. Set LLM_PROVIDER=groq to use Groq instead.',
    modelEnv: {
      supervisor: 'OPENROUTER_SUPERVISOR_MODEL',
      writer: 'OPENROUTER_WRITER_MODEL',
      chart: 'OPENROUTER_CHART_MODEL',
      search: 'OPENROUTER_SEARCH_MODEL',
    } satisfies Record<AgentRole, string>,
  },
  groq: {
    apiKeyEnv: 'GROQ_API_KEY',
    fallbackEnv: 'GROQ_MODEL',
    defaultModel: 'llama-3.3-70b-versatile',
    baseURL: 'https://api.groq.com/openai/v1',
    missingKeyMessage: 'GROQ_API_KEY is missing. Set LLM_PROVIDER=openrouter to use OpenRouter instead.',
    modelEnv: {
      supervisor: 'GROQ_SUPERVISOR_MODEL',
      writer: 'GROQ_WRITER_MODEL',
      chart: 'GROQ_CHART_MODEL',
      search: 'GROQ_SEARCH_MODEL',
    } satisfies Record<AgentRole, string>,
  },
} satisfies Record<ModelProvider, {
  apiKeyEnv: string;
  fallbackEnv: string;
  defaultModel: string;
  baseURL: string;
  missingKeyMessage: string;
  modelEnv: Record<AgentRole, string>;
}>;

const clients = new Map<ModelProvider, ReturnType<typeof createOpenAI>>();

export function resolveModel(role: AgentRole) {
  const provider = resolveProvider();
  const config = PROVIDERS[provider];
  const modelName =
    process.env[config.modelEnv[role]]?.trim() ||
    process.env[config.fallbackEnv]?.trim() ||
    config.defaultModel;

  return getClient(provider)(modelName);
}

export function hasModelProviderConfigured() {
  try {
    return Boolean(process.env[PROVIDERS[resolveProvider()].apiKeyEnv]?.trim());
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

function getClient(provider: ModelProvider) {
  const cached = clients.get(provider);
  if (cached) return cached;

  const config = PROVIDERS[provider];
  const apiKey = process.env[config.apiKeyEnv]?.trim();
  if (!apiKey) throw new Error(config.missingKeyMessage);

  const client = createOpenAI({
    name: provider,
    baseURL: config.baseURL,
    apiKey,
    compatibility: 'compatible',
  });
  clients.set(provider, client);
  return client;
}
