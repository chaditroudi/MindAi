import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AgentConfigRepository, type AgentStatus } from './agent-config.repository';
import { buildProviderValidationRequest } from '../ai/model';

const PROBE_TIMEOUT_MS = 8_000;

const QUOTA_EXHAUSTED_PATTERNS = [
  'free_tier', 'free tier', 'resource_exhausted',
  'insufficient_quota', 'quota exceeded', 'billing',
  'you exceeded your current quota',
];

function isQuotaExhausted(body: string): boolean {
  const lower = body.toLowerCase();
  return QUOTA_EXHAUSTED_PATTERNS.some(p => lower.includes(p));
}

function normalizeModelId(value: string): string {
  return value.trim().toLowerCase();
}

function extractProviderModelIds(provider: string, body: unknown): string[] {
  const normalized = provider.trim().toLowerCase();

  if (normalized === 'google') {
    type GoogleModel = { name?: string; supportedGenerationMethods?: string[] };
    const models = (body as { models?: GoogleModel[] })?.models ?? [];
    return models
      .filter(model => model.supportedGenerationMethods?.includes('generateContent'))
      .map(model => (model.name ?? '').replace(/^models\//, ''))
      .filter(Boolean);
  }

  if (normalized === 'anthropic') {
    type AnthropicModel = { id?: string };
    const models = (body as { data?: AnthropicModel[] })?.data ?? [];
    return models.map(model => model.id ?? '').filter(Boolean);
  }

  type OpenAiCompatModel = { id?: string };
  const models: OpenAiCompatModel[] =
    (body as { data?: OpenAiCompatModel[] })?.data
    ?? (Array.isArray(body) ? (body as OpenAiCompatModel[]) : []);
  return models.map(model => model.id ?? '').filter(Boolean);
}

@Injectable()
export class AgentHealthService {
  private readonly logger = new Logger(AgentHealthService.name);

  constructor(private readonly repo: AgentConfigRepository) {}

  @Cron('*/5 * * * *')
  async checkAllAgents(): Promise<void> {
    const config = await this.repo.get();
    if (!config?.agents?.length) return;

    for (const agent of config.agents) {
      if (agent.status === 'disabled') continue;

      const healthy    = await this.probeProvider(agent.provider, agent.apiKey, agent.model);
      const newStatus: AgentStatus = healthy ? 'active' : 'expired';

      if (agent.status !== newStatus) {
        await this.repo.updateAgentStatus(agent.apiKey, newStatus);
        this.logger.log(
          `agent [${agent.provider}/${agent.model}]: ${agent.status} → ${newStatus}`,
        );
      }
    }
  }

  async probeAndUpdateAgent(agentApiKey: string): Promise<AgentStatus> {
    const config = await this.repo.get();
    const agent  = config?.agents.find(a => a.apiKey === agentApiKey);
    if (!agent) return 'idle';

    const healthy    = await this.probeProvider(agent.provider, agent.apiKey, agent.model);
    const newStatus: AgentStatus = healthy ? 'active' : 'expired';
    await this.repo.updateAgentStatus(agentApiKey, newStatus);
    return newStatus;
  }

  private async probeProvider(provider: string, apiKey: string, model?: string): Promise<boolean> {
    const request = buildProviderValidationRequest(provider, apiKey);
    if (!request) return true; // unknown provider — optimistic, let real request surface errors

    try {
      const res = await fetch(request.url, {
        headers: request.headers,
        signal:  AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });

      if (res.status === 401 || res.status === 403) return false; // definitive auth failure

      if (res.status === 429) {
        const body = await res.text().catch(() => '');
        return !isQuotaExhausted(body); // false only if quota is permanently exhausted
      }

      if (!res.ok) return true; // 404, 500, etc — model-list may fail but key still works

      if (!model?.trim()) return true;

      const payload = await res.json().catch(() => null);
      if (!payload) return true;

      const availableModels = extractProviderModelIds(provider, payload);
      if (!availableModels.length) return true;

      const requested = normalizeModelId(model);
      const found = availableModels.some(id => normalizeModelId(id) === requested);
      if (!found) {
        this.logger.warn(`agent model not in list: ${provider}/${model} — treating as healthy`);
      }
      return true; // model-list check is best-effort; real failures surface on generation
    } catch {
      return true;
    }
  }
}
