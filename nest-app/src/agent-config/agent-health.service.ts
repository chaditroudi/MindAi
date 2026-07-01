import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  AgentConfigRepository,
  type AgentStatus,
} from './agent-config.repository';
import { AgentConfigService } from './agent-config.service';
import { isCooldownActive } from './agent-config.utils';
import { buildProviderValidationRequest } from '../ai/model';

const PROBE_TIMEOUT_MS = 8_000;

const QUOTA_EXHAUSTED_PATTERNS = [
  'free_tier',
  'free tier',
  'resource_exhausted',
  'insufficient_quota',
  'quota exceeded',
  'billing',
  'you exceeded your current quota',
];

function isQuotaExhausted(body: string): boolean {
  const lower = body.toLowerCase();
  return QUOTA_EXHAUSTED_PATTERNS.some((pattern) => lower.includes(pattern));
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
      .filter((model) =>
        model.supportedGenerationMethods?.includes('generateContent'),
      )
      .map((model) => (model.name ?? '').replace(/^models\//, ''))
      .filter(Boolean);
  }

  if (normalized === 'anthropic') {
    type AnthropicModel = { id?: string };
    const models = (body as { data?: AnthropicModel[] })?.data ?? [];
    return models.map((model) => model.id ?? '').filter(Boolean);
  }

  type OpenAiCompatModel = { id?: string };
  const models: OpenAiCompatModel[] =
    (body as { data?: OpenAiCompatModel[] })?.data ??
    (Array.isArray(body) ? (body as OpenAiCompatModel[]) : []);
  return models.map((model) => model.id ?? '').filter(Boolean);
}

@Injectable()
export class AgentHealthService {
  private readonly logger = new Logger(AgentHealthService.name);

  constructor(
    private readonly repo: AgentConfigRepository,
    private readonly config: AgentConfigService,
  ) {}

  @Cron('0 0 1 * *')
  async resetMonthlyUsage(): Promise<void> {
    await this.config.resetAllUsage();
    this.logger.log('monthly token usage counters reset');
  }

  @Cron('* * * * *')
  async checkAllAgents(): Promise<void> {
    const config = await this.config.getConfig();
    if (!config?.agents?.length) return;
    const previousCurrentAgentId = config.currentAgentId;

    for (const agent of config.agents) {
      if (agent.status === 'disabled') continue;
      if (isCooldownActive(agent.cooldownUntil)) continue;

      const healthy = await this.probeProvider(
        agent.provider,
        agent.apiKey,
        agent.model,
      );
      const nextStatus: AgentStatus = healthy ? 'active' : 'expired';

      if (agent.status !== nextStatus) {
        const previousStatus = agent.status;
        await this.repo.updateRuntime(agent.id, {
          status: nextStatus,
          ...(nextStatus === 'active'
            ? { cooldownUntil: null, lastFailureReason: '' }
            : {}),
        });
        agent.status = nextStatus;
        if (nextStatus === 'active') {
          agent.cooldownUntil = null;
          agent.lastFailureReason = '';
        }
        this.logger.log(
          `agent [${agent.provider}/${agent.model}]: ${previousStatus} -> ${nextStatus}`,
        );
      }
    }

    const nextCurrentAgentId = await this.config.syncCurrentAgent(config);
    if (nextCurrentAgentId !== previousCurrentAgentId) {
      const nextAgent = nextCurrentAgentId
        ? config.agents.find((agent) => agent.id === nextCurrentAgentId)
        : null;
      const previousAgent = previousCurrentAgentId
        ? config.agents.find((agent) => agent.id === previousCurrentAgentId)
        : null;
      const previousLabel = previousAgent
        ? `${previousAgent.provider}/${previousAgent.model}`
        : 'none';
      const nextLabel = nextAgent
        ? `${nextAgent.provider}/${nextAgent.model}`
        : 'none';
      this.logger.log(
        `current agent switched: ${previousLabel} -> ${nextLabel}`,
      );
    }
  }

  async probeAndUpdateAgent(agentId: string): Promise<AgentStatus> {
    const config = await this.config.getConfig();
    const agent = config?.agents.find((a) => a.id === agentId);
    if (!agent) return 'idle';
    if (isCooldownActive(agent.cooldownUntil)) return agent.status;

    const healthy = await this.probeProvider(
      agent.provider,
      agent.apiKey,
      agent.model,
    );
    const nextStatus: AgentStatus = healthy ? 'active' : 'expired';

    if (agent.status !== nextStatus) {
      const previousStatus = agent.status;
      await this.repo.updateRuntime(agent.id, {
        status: nextStatus,
        ...(nextStatus === 'active'
          ? { cooldownUntil: null, lastFailureReason: '' }
          : {}),
      });
      this.logger.log(
        `agent [${agent.provider}/${agent.model}]: ${previousStatus} -> ${nextStatus}`,
      );
    }

    agent.status = nextStatus;
    if (nextStatus === 'active') {
      agent.cooldownUntil = null;
      agent.lastFailureReason = '';
    }
    await this.config.syncCurrentAgent(config);

    return nextStatus;
  }

  private async probeProvider(
    provider: string,
    apiKey: string,
    model?: string,
  ): Promise<boolean> {
    const request = buildProviderValidationRequest(provider, apiKey);
    if (!request) return true;

    try {
      const res = await fetch(request.url, {
        headers: request.headers,
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });

      if (res.status === 401 || res.status === 403) return false;

      if (res.status === 429) {
        const body = await res.text().catch(() => '');
        return !isQuotaExhausted(body);
      }

      if (!res.ok) return true;
      if (!model?.trim()) return true;

      const payload = await res.json().catch(() => null);
      if (!payload) return true;

      const availableModels = extractProviderModelIds(provider, payload);
      if (!availableModels.length) return true;

      const requested = normalizeModelId(model);
      const found = availableModels.some(
        (id) => normalizeModelId(id) === requested,
      );
      if (!found) {
        this.logger.warn(
          `agent model not in list: ${provider}/${model} — marking as expired`,
        );
        return false;
      }

      return true;
    } catch {
      return true;
    }
  }
}
