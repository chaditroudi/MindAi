import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AgentConfigRepository, type AgentEntry, type AgentHealthUpdate, type AgentStatus } from './agent-config.repository';
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

function parseRetryDelayMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs > 0) return Math.ceil(secs * 1000);

  const compound = /^(\d+)m([\d.]+)s$/i.exec(value);
  if (compound) {
    return (parseInt(compound[1], 10) * 60_000) + Math.ceil(parseFloat(compound[2]) * 1000);
  }

  const secondsOnly = /^([\d.]+)s$/i.exec(value);
  if (secondsOnly) return Math.ceil(parseFloat(secondsOnly[1]) * 1000);

  return null;
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

type ProbeOutcome = {
  status: AgentStatus | 'unchanged';
  health: AgentHealthUpdate;
};

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

      const outcome = await this.probeProvider(agent);
      await this.applyProbeOutcome(agent, outcome);
    }
  }

  async probeAndUpdateAgent(agentApiKey: string): Promise<AgentStatus> {
    const config = await this.repo.get();
    const agent  = config?.agents.find(a => a.apiKey === agentApiKey);
    if (!agent) return 'idle';

    const outcome = await this.probeProvider(agent);
    await this.applyProbeOutcome(agent, outcome);
    return outcome.status === 'unchanged' ? agent.status : outcome.status;
  }

  private async applyProbeOutcome(agent: AgentEntry, outcome: ProbeOutcome): Promise<void> {
    const nextStatus = outcome.status === 'unchanged' ? agent.status : outcome.status;
    await this.repo.updateHealth(agent.apiKey, {
      ...outcome.health,
      ...(outcome.status !== 'unchanged' ? { status: nextStatus } : {}),
    });

    if (outcome.status !== 'unchanged' && agent.status !== nextStatus) {
      this.logger.log(
        `agent [${agent.provider}/${agent.model}]: ${agent.status} → ${nextStatus}`,
      );
    }
  }

  private async probeProvider(agent: AgentEntry): Promise<ProbeOutcome> {
    const { provider, apiKey, model } = agent;
    const checkedAt = new Date();
    const request = buildProviderValidationRequest(provider, apiKey);
    if (!request) {
      return {
        status: 'unchanged',
        health: { lastCheckedAt: checkedAt },
      };
    }

    try {
      const res = await fetch(request.url, {
        headers: request.headers,
        signal:  AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });

      if (res.status === 401 || res.status === 403) {
        return {
          status: 'expired',
          health: {
            lastCheckedAt: checkedAt,
            lastFailureReason: 'Authentication failed for this API key.',
            consecutiveFailures: (agent.consecutiveFailures ?? 0) + 1,
          },
        };
      }

      if (res.status === 429) {
        const body = await res.text().catch(() => '');
        if (isQuotaExhausted(body)) {
          return {
            status: 'expired',
            health: {
              lastCheckedAt: checkedAt,
              lastFailureReason: 'Provider quota is exhausted for this connection.',
              consecutiveFailures: (agent.consecutiveFailures ?? 0) + 1,
            },
          };
        }

        const retryHeader = res.headers.get('retry-after') ?? res.headers.get('x-ratelimit-reset-tokens');
        const delayMs = parseRetryDelayMs(retryHeader) ?? 5 * 60_000;
        return {
          status: 'idle',
          health: {
            lastCheckedAt: checkedAt,
            cooldownUntil: new Date(Date.now() + delayMs),
            lastFailureReason: 'Provider rate limit reached. Cooling down before retry.',
            consecutiveFailures: (agent.consecutiveFailures ?? 0) + 1,
          },
        };
      }

      if (!res.ok) {
        return {
          status: 'unchanged',
          health: {
            lastCheckedAt: checkedAt,
            lastFailureReason: `Provider health probe returned ${res.status}; keeping previous status.`,
          },
        };
      }

      if (!model?.trim()) {
        return {
          status: 'active',
          health: {
            lastCheckedAt: checkedAt,
            lastHealthyAt: checkedAt,
            cooldownUntil: null,
            lastFailureReason: '',
            consecutiveFailures: 0,
          },
        };
      }

      const payload = await res.json().catch(() => null);
      if (!payload) {
        return {
          status: 'active',
          health: {
            lastCheckedAt: checkedAt,
            lastHealthyAt: checkedAt,
            cooldownUntil: null,
            lastFailureReason: '',
            consecutiveFailures: 0,
          },
        };
      }

      const availableModels = extractProviderModelIds(provider, payload);
      if (!availableModels.length) {
        return {
          status: 'active',
          health: {
            lastCheckedAt: checkedAt,
            lastHealthyAt: checkedAt,
            cooldownUntil: null,
            lastFailureReason: '',
            consecutiveFailures: 0,
          },
        };
      }

      const requested = normalizeModelId(model);
      const found = availableModels.some(id => normalizeModelId(id) === requested);
      if (!found) {
        this.logger.warn(`agent model not in list: ${provider}/${model} — treating as healthy`);
        return {
          status: 'active',
          health: {
            lastCheckedAt: checkedAt,
            lastHealthyAt: checkedAt,
            cooldownUntil: null,
            lastFailureReason: 'Configured model not present in provider list; generation may still fail later.',
            consecutiveFailures: 0,
          },
        };
      }

      return {
        status: 'active',
        health: {
          lastCheckedAt: checkedAt,
          lastHealthyAt: checkedAt,
          cooldownUntil: null,
          lastFailureReason: '',
          consecutiveFailures: 0,
        },
      };
    } catch {
      return {
        status: 'unchanged',
        health: {
          lastCheckedAt: checkedAt,
          lastFailureReason: 'Provider probe failed due to network or temporary provider error.',
        },
      };
    }
  }
}
