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

/**
 * The "resolved" view of the pooled-agent config — what callers outside this
 * service actually work with. Distinct from the raw AgentConfigDocument
 * because getConfig() below may have just self-healed the stored data (fixed
 * duplicate ids, re-picked currentAgentId) before returning it.
 */
export interface ResolvedConfig {
  memoryLimit: number;
  currentAgentId: string | null;
  agents: AgentEntry[];
}

// Returned when no AgentConfig document exists yet at all (fresh install,
// nobody has configured any pooled agents).
const DEFAULTS: ResolvedConfig = {
  memoryLimit: 50,
  currentAgentId: null,
  agents: [],
};

// ── small sanitizing helpers used by sanitizeAgentEntry/sanitizePayload ────
// These exist because incoming admin-edit payloads are arbitrary JSON from
// an HTTP body — even though the controller's class-validator DTOs already
// reject obviously-wrong shapes, these helpers defensively coerce/trim/drop
// values one more time right before they're merged into the stored config.

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

// currentAgentId is special: `null` is a meaningful value ("no current
// agent"), distinct from `undefined` ("caller didn't mention this field at
// all, leave it as-is"). The two other helpers above collapse invalid input
// to `undefined`; this one preserves an explicit `null`.
function nullableTrimmedString(
  value?: string | null,
): string | null | undefined {
  if (value === null) return null;
  return trimOrUndefined(value ?? undefined);
}

/**
 * Cleans one incoming agent entry field-by-field. Notice this returns a
 * Partial<AgentEntry> — fields that fail their sanity check are simply
 * dropped (become undefined) rather than throwing, since sanitizePayload
 * below treats "field not sent" as "don't change this field."
 */
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

/**
 * Walks the agent list and guarantees every entry ends up with a unique,
 * non-empty id — generating a fresh UUID for any agent that's missing one,
 * or that collides with an id already seen earlier in the same array.
 *
 * This exists because agents arrive from an admin-edited JSON payload with
 * no guarantee of id uniqueness (a copy-pasted entry, a client-side bug, a
 * new agent that simply has no id yet). Returns `changed: true` whenever any
 * id actually had to be assigned/regenerated, so the caller (getConfig, save)
 * knows whether it needs to persist the correction.
 */
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

  /** An agent is usable as the "current" one only if it's active and not cooling down. */
  private canBeCurrentAgent(agent: AgentEntry, now = Date.now()): boolean {
    return (
      agent.status === 'active' && !isCooldownActive(agent.cooldownUntil, now)
    );
  }

  /**
   * Decides which agent should be `currentAgentId` given the current list.
   * Prefers keeping the existing choice if it's still eligible (so we don't
   * needlessly bounce between agents on every read); otherwise falls back to
   * the first eligible agent in array order; otherwise null (nothing usable).
   */
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

  /**
   * Merges an incoming (already-sanitized) agent edit on top of the
   * previously-stored entry for the same agent, so fields the admin form
   * doesn't send (usage counters, cooldown state, last failure reason) carry
   * forward untouched instead of resetting to defaults on every save.
   * If there's no existing entry (a brand-new agent), the incoming data is
   * used as-is.
   */
  private mergeRuntimeState(
    incoming: Partial<AgentEntry>,
    existing?: AgentEntry,
  ): Partial<AgentEntry> {
    if (!existing) return incoming;
    return {
      ...existing,
      ...incoming,
      // Explicitly re-pin the runtime fields to the existing values even
      // though the spread above would already take `incoming`'s value if
      // present — this guards against the incoming payload accidentally
      // including a stale/zeroed value for one of these fields.
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

  /**
   * Reads the pooled-agent config, self-healing it on every call:
   *  1. de-duplicate/assign agent ids (ensureAgentIds)
   *  2. re-pick currentAgentId if the stored one is no longer eligible
   *  3. persist the correction ONLY if something actually needed fixing —
   *     this method runs on the hot path of every analytics request via
   *     AnalyticsService, so an unconditional write here would mean an extra
   *     Mongo write on every single request.
   */
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
      // Something needed correcting (a duplicate/missing id, or the current
      // agent pointer drifted) — write the fix back so future reads don't
      // have to redo this work, then return the freshly-saved values.
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

    // Nothing to fix — return the stored data as-is, no write needed.
    return {
      memoryLimit: doc.memoryLimit ?? DEFAULTS.memoryLimit,
      currentAgentId,
      agents: doc.agents ?? [],
    };
  }

  /** Alias kept for callers that conceptually want "the active agent" rather than "the current one" — same thing today. */
  async getActiveAgent(): Promise<AgentEntry | null> {
    return this.getCurrentAgent();
  }

  async getCurrentAgent(): Promise<AgentEntry | null> {
    const cfg = await this.getConfig();
    if (!cfg.currentAgentId) return null;
    return cfg.agents.find((agent) => agent.id === cfg.currentAgentId) ?? null;
  }

  /**
   * Applies an admin edit (from PUT /api/agent-config). The tricky part is
   * reconciling the *incoming* agent list against what's already stored
   * without losing runtime state (usage counters, cooldown, failure reason)
   * for agents that already exist — see mergeRuntimeState above.
   *
   * Matching an incoming agent to an existing one is done by id first, and
   * by apiKey as a fallback — the apiKey fallback covers the case where an
   * agent's id got regenerated client-side (e.g. it arrived with no id and
   * ensureAgentIds assigned a fresh one) but its underlying connection is
   * actually unchanged; without it, that agent's usage counters would
   * silently reset to zero on every edit.
   */
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
    // Re-evaluate currentAgentId against the *new* agent list — an edit
    // might have disabled or removed the previously-current agent.
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

  /**
   * Re-derives currentAgentId from the given (or freshly-fetched) config and
   * persists it if it changed. Called after any event that might make the
   * previously-current agent ineligible: a status/cooldown change via
   * updateRuntime, or the health-check cron's per-minute sweep.
   */
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

  /** Adds to this agent's lifetime usage counters. No-op if there's nothing to add (avoids a pointless write). */
  async trackUsage(
    agentId: string,
    inputTokens: number,
    outputTokens: number,
  ): Promise<void> {
    if (inputTokens <= 0 && outputTokens <= 0) return;
    await this.repo.incrementUsage(agentId, inputTokens, outputTokens);
  }

  /** Records how big the most recent successful request against this agent was — used for future pre-flight limit estimates. */
  async updateLastInputTokens(
    agentId: string,
    inputTokens: number,
  ): Promise<void> {
    if (inputTokens > 0)
      await this.repo.setLastInputTokens(agentId, inputTokens);
  }

  /** Admin-facing status change (e.g. manually disabling an agent) — also re-syncs currentAgentId since a status flip can affect eligibility. */
  async updateStatus(agentId: string, status: AgentStatus): Promise<void> {
    await this.repo.updateAgentStatus(agentId, status);
    await this.syncCurrentAgent();
  }

  /**
   * Called by AnalyticsService when a request against this agent fails
   * (invalid key, rate limit, model not found) or by the health-check cron.
   * Only re-syncs currentAgentId when the change could actually affect
   * eligibility (status or cooldown) — a lastFailureReason-only update
   * (just recording *why*, not changing eligibility) skips the extra
   * getConfig()+possible-write round trip.
   */
  async updateRuntime(
    agentId: string,
    update: AgentRuntimeUpdate,
  ): Promise<void> {
    await this.repo.updateRuntime(agentId, update);
    if (update.status !== undefined || update.cooldownUntil !== undefined) {
      await this.syncCurrentAgent();
    }
  }

  /** Admin-facing: adjusts one agent's configured token ceiling (input/output/memory). */
  async updateTokenLimit(
    agentId: string,
    field: 'inputTokenLimit' | 'outputTokenLimit' | 'memoryTokenLimit',
    value: number,
  ): Promise<void> {
    await this.repo.updateTokenLimit(agentId, field, value);
  }

  /** Monthly cron entry point — zeroes every pooled agent's usage counters at once. */
  async resetAllUsage(): Promise<void> {
    await this.repo.resetAllUsage();
  }
}
