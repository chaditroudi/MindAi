import { Injectable } from '@nestjs/common';
import {
  AgentConfigRepository,
  type AgentConfigPayload,
  type AgentEntry,
  type AgentRuntimeUpdate,
  type AgentStatus,
} from './agent-config.repository';

export interface ResolvedConfig {
  memoryLimit: number;
  agents: AgentEntry[];
}

const DEFAULTS: ResolvedConfig = {
  memoryLimit: 50,
  agents: [],
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
    memoryTokenLimit: positiveIntOrUndefined(agent.memoryTokenLimit),
    inputTokensUsed:  nonNegativeIntOrUndefined(agent.inputTokensUsed),
    outputTokensUsed: nonNegativeIntOrUndefined(agent.outputTokensUsed),
    lastInputTokens:  nonNegativeIntOrUndefined(agent.lastInputTokens),
    cooldownUntil:    agent.cooldownUntil ?? undefined,
    lastFailureReason: trimOrUndefined(agent.lastFailureReason),
  };
}

function sanitizePayload(data: AgentConfigPayload): AgentConfigPayload {
  return {
    memoryLimit: positiveIntOrUndefined(data.memoryLimit),
    agents: data.agents?.map(agent => sanitizeAgentEntry(agent)),
  };
}

@Injectable()
export class AgentConfigService {
  constructor(private readonly repo: AgentConfigRepository) {}

  private mergeRuntimeState(incoming: Partial<AgentEntry>, existing?: AgentEntry): Partial<AgentEntry> {
    if (!existing) return incoming;
    return {
      ...existing,
      ...incoming,
      inputTokensUsed: incoming.inputTokensUsed ?? existing.inputTokensUsed,
      outputTokensUsed: incoming.outputTokensUsed ?? existing.outputTokensUsed,
      memoryTokenLimit: incoming.memoryTokenLimit ?? existing.memoryTokenLimit,
      lastInputTokens: incoming.lastInputTokens ?? existing.lastInputTokens,
      cooldownUntil: incoming.cooldownUntil ?? existing.cooldownUntil,
      lastFailureReason: incoming.lastFailureReason ?? existing.lastFailureReason,
    };
  }

  async getConfig(): Promise<ResolvedConfig> {
    const doc = await this.repo.get();
    if (!doc) return { ...DEFAULTS };
    return {
      memoryLimit: doc.memoryLimit ?? DEFAULTS.memoryLimit,
      agents: doc.agents ?? [],
    };
  }

  async getActiveAgent(): Promise<AgentEntry | null> {
    const cfg = await this.getConfig();
    return cfg.agents.find(a => a.status === 'active') ?? null;
  }

  async save(data: AgentConfigPayload): Promise<ResolvedConfig> {
    const current = await this.repo.get();
    const currentByApiKey = new Map((current?.agents ?? []).map(agent => [agent.apiKey, agent]));
    const sanitized = sanitizePayload(data);
    const mergedAgents = sanitized.agents?.map(agent =>
      this.mergeRuntimeState(agent, agent.apiKey ? currentByApiKey.get(agent.apiKey) : undefined),
    );

    const doc = await this.repo.save({
      ...sanitized,
      ...(mergedAgents ? { agents: mergedAgents } : {}),
    });
    return {
      memoryLimit: doc.memoryLimit,
      agents: doc.agents,
    };
  }

  async trackUsage(agentApiKey: string, inputTokens: number, outputTokens: number): Promise<void> {
    if (inputTokens <= 0 && outputTokens <= 0) return;
    await this.repo.incrementUsage(agentApiKey, inputTokens, outputTokens);
  }

  async updateLastInputTokens(agentApiKey: string, inputTokens: number): Promise<void> {
    if (inputTokens > 0) await this.repo.setLastInputTokens(agentApiKey, inputTokens);
  }

  async updateStatus(agentApiKey: string, status: AgentStatus): Promise<void> {
    await this.repo.updateAgentStatus(agentApiKey, status);
  }

  async updateRuntime(agentApiKey: string, update: AgentRuntimeUpdate): Promise<void> {
    await this.repo.updateRuntime(agentApiKey, update);
  }

  async updateTokenLimit(
    agentApiKey: string,
    field: 'inputTokenLimit' | 'outputTokenLimit' | 'memoryTokenLimit',
    value: number,
  ): Promise<void> {
    await this.repo.updateTokenLimit(agentApiKey, field, value);
  }
}
