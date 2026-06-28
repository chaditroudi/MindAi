import { Injectable } from '@nestjs/common';
import {
  AgentConfigRepository,
  type AgentConfigPayload,
  type AgentEntry,
} from './agent-config.repository';

export interface ResolvedConfig {
  inputTokenLimit:  number;
  outputTokenLimit: number;
  memoryLimit:      number;
  agents:           AgentEntry[];
}

const DEFAULTS: ResolvedConfig = {
  inputTokenLimit:  4_000,
  outputTokenLimit: 800,
  memoryLimit:      50,
  agents:           [],
};

@Injectable()
export class AgentConfigService {
  constructor(private readonly repo: AgentConfigRepository) {}

  async getConfig(): Promise<ResolvedConfig> {
    const doc = await this.repo.get();
    if (!doc) return { ...DEFAULTS };
    return {
      inputTokenLimit:  doc.inputTokenLimit  ?? DEFAULTS.inputTokenLimit,
      outputTokenLimit: doc.outputTokenLimit ?? DEFAULTS.outputTokenLimit,
      memoryLimit:      doc.memoryLimit      ?? DEFAULTS.memoryLimit,
      agents:           doc.agents           ?? [],
    };
  }

  async getActiveAgent(): Promise<AgentEntry | null> {
    const cfg = await this.getConfig();
    return cfg.agents.find(a => a.status === 'active') ?? null;
  }

  async save(data: AgentConfigPayload): Promise<ResolvedConfig> {
    const doc = await this.repo.save(data);
    return {
      inputTokenLimit:  doc.inputTokenLimit,
      outputTokenLimit: doc.outputTokenLimit,
      memoryLimit:      doc.memoryLimit,
      agents:           doc.agents,
    };
  }

  async updateAgentStatus(index: number, status: AgentEntry['status']): Promise<void> {
    const cfg = await this.getConfig();
    if (index < 0 || index >= cfg.agents.length) return;
    cfg.agents[index].status = status;
    await this.repo.save({ agents: cfg.agents });
  }
}
