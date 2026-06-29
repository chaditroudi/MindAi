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

      const healthy    = await this.probeProvider(agent.provider, agent.apiKey);
      const newStatus: AgentStatus = healthy ? 'active' : 'expired';

      if (agent.status !== newStatus) {
        await this.repo.updateAgentStatus(agent.apiKey, newStatus);
        this.logger.log(
          `agent [${agent.provider}/${agent.model}]: ${agent.status} → ${newStatus}`,
        );
      }
    }
  }

  // Expose for manual triggers (e.g. after admin saves a new agent)
  async probeAndUpdateAgent(agentApiKey: string): Promise<AgentStatus> {
    const config = await this.repo.get();
    const agent  = config?.agents.find(a => a.apiKey === agentApiKey);
    if (!agent) return 'idle';

    const healthy    = await this.probeProvider(agent.provider, agent.apiKey);
    const newStatus: AgentStatus = healthy ? 'active' : 'expired';
    await this.repo.updateAgentStatus(agentApiKey, newStatus);
    return newStatus;
  }

  private async probeProvider(provider: string, apiKey: string): Promise<boolean> {
    const request = buildProviderValidationRequest(provider, apiKey);
    if (!request) return true; // unknown provider — optimistic, let real request surface errors

    try {
      const res = await fetch(request.url, {
        headers: request.headers,
        signal:  AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });

      if (res.status === 401 || res.status === 403) return false; // invalid key

      if (res.status === 429) {
        const body = await res.text().catch(() => '');
        return !isQuotaExhausted(body);
      }

      return res.ok;
    } catch {
      return true;
    }
  }
}
