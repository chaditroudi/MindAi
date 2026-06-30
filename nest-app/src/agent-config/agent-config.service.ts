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

function trimOrUndefined(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function positiveIntOrUndefined(value?: number): number | undefined {
  return Number.isFinite(value) && (value as number) > 0 ? Math.round(value as number) : undefined;
}

function nonNegativeIntOrUndefined(value?: number): number | undefined {
  return Number.isFinite(value) && (value as number) >= 0 ? Math.round(value as number) : undefined;
}

function sanitizeAgentEntry(agent: Partial<AgentEntry>): Partial<AgentEntry> {
  return {
    ...agent,
    provider:         trimOrUndefined(agent.provider)?.toLowerCase(),
    model:            trimOrUndefined(agent.model),
    apiKey:           trimOrUndefined(agent.apiKey),
    inputTokenLimit:  positiveIntOrUndefined(agent.inputTokenLimit),
    outputTokenLimit: positiveIntOrUndefined(agent.outputTokenLimit),
    inputTokensUsed:  nonNegativeIntOrUndefined(agent.inputTokensUsed),
    outputTokensUsed: nonNegativeIntOrUndefined(agent.outputTokensUsed),
  };
}

function sanitizePayload(data: AgentConfigPayload): AgentConfigPayload {
  return {
    memoryLimit: positiveIntOrUndefined(data.memoryLimit),
    agents:      data.agents?.map(agent => sanitizeAgentEntry(agent)),
  };
}

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
    const doc = await this.repo.save(sanitizePayload(data));
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
