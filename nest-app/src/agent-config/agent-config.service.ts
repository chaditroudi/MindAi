import { Injectable } from '@nestjs/common';
import {
  AgentConfigRepository,
  type AgentConfigPayload,
  type AgentEntry,
} from './agent-config.repository';

export interface ResolvedConfig {
  memoryLimit: number;
  agents:      AgentEntry[];
}

const DEFAULTS: ResolvedConfig = {
  memoryLimit: 50,
  agents:      [],
};

@Injectable()
export class AgentConfigService {
  constructor(private readonly repo: AgentConfigRepository) {}

  async getConfig(): Promise<ResolvedConfig> {
    const doc = await this.repo.get();
    if (!doc) return { ...DEFAULTS };
    return {
      memoryLimit: doc.memoryLimit ?? DEFAULTS.memoryLimit,
      agents:      doc.agents      ?? [],
    };
  }

  async getActiveAgent(): Promise<AgentEntry | null> {
    const cfg = await this.getConfig();
    return cfg.agents.find(a => a.status === 'active') ?? null;
  }

  async save(data: AgentConfigPayload): Promise<ResolvedConfig> {
    const doc = await this.repo.save(data);
    return {
      memoryLimit: doc.memoryLimit,
      agents:      doc.agents,
    };
  }

  async trackUsage(agentApiKey: string, inputTokens: number, outputTokens: number): Promise<void> {
    if (inputTokens <= 0 && outputTokens <= 0) return;
    await this.repo.incrementUsage(agentApiKey, inputTokens, outputTokens);
  }
}
