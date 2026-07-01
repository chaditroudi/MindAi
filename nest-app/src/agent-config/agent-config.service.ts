import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AgentConfigRepository,
  type AgentConfigPayload,
  type AgentEntry,
  type AgentRuntimeUpdate,
  type AgentStatus,
} from './agent-config.repository';
import { isCooldownActive } from './agent-config.utils';

export interface ResolvedConfig {
  memoryLimit: number;
  currentAgentId: string | null;
  agents: AgentEntry[];
}

const DEFAULTS: ResolvedConfig = {
  memoryLimit: 50,
  currentAgentId: null,
  agents: [],
};

function trimOrUndefined(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function positiveIntOrUndefined(value?: number): number | undefined {
  return Number.isFinite(value) && (value as number) > 0
    ? Math.round(value as number)
    : undefined;
}

function nonNegativeIntOrUndefined(value?: number): number | undefined {
  return Number.isFinite(value) && (value as number) >= 0
    ? Math.round(value as number)
    : undefined;
}

function nullableTrimmedString(
  value?: string | null,
): string | null | undefined {
  if (value === null) return null;
  return trimOrUndefined(value ?? undefined);
}

function sanitizeAgentEntry(agent: Partial<AgentEntry>): Partial<AgentEntry> {
  return {
    ...agent,
    id: trimOrUndefined(agent.id),
    provider: trimOrUndefined(agent.provider)?.toLowerCase(),
    model: trimOrUndefined(agent.model),
    apiKey: trimOrUndefined(agent.apiKey),
    inputTokenLimit: positiveIntOrUndefined(agent.inputTokenLimit),
    outputTokenLimit: positiveIntOrUndefined(agent.outputTokenLimit),
    memoryTokenLimit: positiveIntOrUndefined(agent.memoryTokenLimit),
    inputTokensUsed: nonNegativeIntOrUndefined(agent.inputTokensUsed),
    outputTokensUsed: nonNegativeIntOrUndefined(agent.outputTokensUsed),
    lastInputTokens: nonNegativeIntOrUndefined(agent.lastInputTokens),
    cooldownUntil: agent.cooldownUntil ?? undefined,
    lastFailureReason: trimOrUndefined(agent.lastFailureReason),
  };
}

function sanitizePayload(data: AgentConfigPayload): AgentConfigPayload {
  return {
    memoryLimit: positiveIntOrUndefined(data.memoryLimit),
    currentAgentId: nullableTrimmedString(data.currentAgentId),
    agents: data.agents?.map((agent) => sanitizeAgentEntry(agent)),
  };
}

function ensureAgentIds(agents: Partial<AgentEntry>[] = []): {
  agents: Partial<AgentEntry>[];
  changed: boolean;
} {
  const seen = new Set<string>();
  let changed = false;

  const normalized = agents.map((rawAgent) => {
    const agent = sanitizeAgentEntry(rawAgent);
    let id = agent.id;

    if (!id || seen.has(id)) {
      id = randomUUID();
      changed = true;
    }

    if (id !== agent.id) changed = true;
    seen.add(id);

    return { ...agent, id };
  });

  return { agents: normalized, changed };
}

@Injectable()
export class AgentConfigService {
  constructor(private readonly repo: AgentConfigRepository) {}

  private canBeCurrentAgent(agent: AgentEntry, now = Date.now()): boolean {
    return (
      agent.status === 'active' && !isCooldownActive(agent.cooldownUntil, now)
    );
  }

  private pickCurrentAgentId(
    currentAgentId: string | null | undefined,
    agents: AgentEntry[],
  ): string | null {
    const current = currentAgentId
      ? agents.find((agent) => agent.id === currentAgentId)
      : undefined;

    if (current && this.canBeCurrentAgent(current)) return current.id;
    return agents.find((agent) => this.canBeCurrentAgent(agent))?.id ?? null;
  }

  private mergeRuntimeState(
    incoming: Partial<AgentEntry>,
    existing?: AgentEntry,
  ): Partial<AgentEntry> {
    if (!existing) return incoming;
    return {
      ...existing,
      ...incoming,
      id: incoming.id ?? existing.id,
      inputTokensUsed: incoming.inputTokensUsed ?? existing.inputTokensUsed,
      outputTokensUsed: incoming.outputTokensUsed ?? existing.outputTokensUsed,
      memoryTokenLimit: incoming.memoryTokenLimit ?? existing.memoryTokenLimit,
      lastInputTokens: incoming.lastInputTokens ?? existing.lastInputTokens,
      cooldownUntil: incoming.cooldownUntil ?? existing.cooldownUntil,
      lastFailureReason:
        incoming.lastFailureReason ?? existing.lastFailureReason,
    };
  }

  async getConfig(): Promise<ResolvedConfig> {
    const doc = await this.repo.get();
    if (!doc) return { ...DEFAULTS };

    const normalized = ensureAgentIds(doc.agents ?? []);
    const normalizedAgents = normalized.agents as AgentEntry[];
    const currentAgentId = this.pickCurrentAgentId(
      doc.currentAgentId ?? null,
      normalizedAgents,
    );
    const currentChanged = currentAgentId !== (doc.currentAgentId ?? null);

    if (normalized.changed || currentChanged) {
      const saved = await this.repo.save({
        memoryLimit: doc.memoryLimit,
        currentAgentId,
        agents: normalized.agents,
      });
      return {
        memoryLimit: saved.memoryLimit ?? DEFAULTS.memoryLimit,
        currentAgentId: saved.currentAgentId ?? null,
        agents: saved.agents ?? [],
      };
    }

    return {
      memoryLimit: doc.memoryLimit ?? DEFAULTS.memoryLimit,
      currentAgentId,
      agents: doc.agents ?? [],
    };
  }

  async getActiveAgent(): Promise<AgentEntry | null> {
    return this.getCurrentAgent();
  }

  async getCurrentAgent(): Promise<AgentEntry | null> {
    const cfg = await this.getConfig();
    if (!cfg.currentAgentId) return null;
    return cfg.agents.find((agent) => agent.id === cfg.currentAgentId) ?? null;
  }

  async save(data: AgentConfigPayload): Promise<ResolvedConfig> {
    const current = await this.getConfig();
    const currentById = new Map(
      current.agents.map((agent) => [agent.id, agent]),
    );
    const currentByApiKey = new Map(
      current.agents.map((agent) => [agent.apiKey, agent]),
    );
    const sanitized = sanitizePayload(data);
    const normalizedIncoming = sanitized.agents
      ? ensureAgentIds(sanitized.agents).agents
      : undefined;
    const mergedAgents = normalizedIncoming?.map((agent) =>
      this.mergeRuntimeState(
        agent,
        (agent.id ? currentById.get(agent.id) : undefined) ??
          (agent.apiKey ? currentByApiKey.get(agent.apiKey) : undefined),
      ),
    );

    const nextAgents = (mergedAgents ?? current.agents) as AgentEntry[];
    const nextCurrentAgentId = this.pickCurrentAgentId(
      sanitized.currentAgentId ?? current.currentAgentId,
      nextAgents,
    );

    const doc = await this.repo.save({
      ...sanitized,
      currentAgentId: nextCurrentAgentId,
      ...(mergedAgents ? { agents: mergedAgents } : {}),
    });
    return {
      memoryLimit: doc.memoryLimit,
      currentAgentId: doc.currentAgentId ?? null,
      agents: doc.agents,
    };
  }

  async syncCurrentAgent(config?: ResolvedConfig): Promise<string | null> {
    const resolved = config ?? (await this.getConfig());
    const nextCurrentAgentId = this.pickCurrentAgentId(
      resolved.currentAgentId,
      resolved.agents,
    );
    if (nextCurrentAgentId !== resolved.currentAgentId) {
      await this.repo.updateCurrentAgentId(nextCurrentAgentId);
    }
    return nextCurrentAgentId;
  }

  async trackUsage(
    agentId: string,
    inputTokens: number,
    outputTokens: number,
  ): Promise<void> {
    if (inputTokens <= 0 && outputTokens <= 0) return;
    await this.repo.incrementUsage(agentId, inputTokens, outputTokens);
  }

  async updateLastInputTokens(
    agentId: string,
    inputTokens: number,
  ): Promise<void> {
    if (inputTokens > 0)
      await this.repo.setLastInputTokens(agentId, inputTokens);
  }

  async updateStatus(agentId: string, status: AgentStatus): Promise<void> {
    await this.repo.updateAgentStatus(agentId, status);
    await this.syncCurrentAgent();
  }

  async updateRuntime(
    agentId: string,
    update: AgentRuntimeUpdate,
  ): Promise<void> {
    await this.repo.updateRuntime(agentId, update);
    if (update.status !== undefined || update.cooldownUntil !== undefined) {
      await this.syncCurrentAgent();
    }
  }

  async updateTokenLimit(
    agentId: string,
    field: 'inputTokenLimit' | 'outputTokenLimit' | 'memoryTokenLimit',
    value: number,
  ): Promise<void> {
    await this.repo.updateTokenLimit(agentId, field, value);
  }
}
