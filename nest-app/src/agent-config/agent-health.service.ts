import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { appendFileSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import {
  AgentConfigRepository,
  type AgentStatus,
} from './agent-config.repository';
import { AgentConfigService } from './agent-config.service';
import { isCooldownActive } from './agent-config.utils';
import { buildProviderValidationRequest } from '../ai/model';

const PROBE_TIMEOUT_MS = 8_000;

const LOG_DIR = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'agent-health.log');

function writeHealthLog(lines: string[]): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const stamp = new Date().toISOString();
    const body = lines.map((line) => `[${stamp}] ${line}`).join('\n') + '\n';
    appendFileSync(LOG_FILE, body, 'utf8');
  } catch {
    // Best-effort only — a disk/permissions problem here must never take
    // down the health check itself, so failures are swallowed silently.
  }
}

// Substrings that indicate a 429 response means "this key's quota is
// genuinely exhausted" rather than "just a transient rate limit" — checked
// against the raw response body text.
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

/**
 * Pulls the list of currently-available model ids out of a provider's
 * "/models"-style response — each provider shapes this response differently,
 * mirroring the same per-provider parsing done in ai/model.ts's
 * fetchProviderModels (kept separate here since this file has a slightly
 * different need: just the id list, not id+label pairs).
 */
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

  // OpenAI-compatible providers (OpenAI, Groq, Mistral, Together, Perplexity)
  // all shape their /models response the same way.
  type OpenAiCompatModel = { id?: string };
  const models: OpenAiCompatModel[] =
    (body as { data?: OpenAiCompatModel[] })?.data ??
    (Array.isArray(body) ? (body as OpenAiCompatModel[]) : []);
  return models.map((model) => model.id ?? '').filter(Boolean);
}

/**
 * AgentHealthService
 * -------------------
 * Two scheduled jobs that keep the pooled-agent pool self-correcting without
 * any admin intervention: a per-minute liveness probe, and a monthly usage
 * reset. Also exposes probeAndUpdateAgent() for an on-demand check of a
 * single agent (e.g. right after an admin edits the config — see
 * AgentConfigController.save()).
 */
@Injectable()
export class AgentHealthService {
  private readonly logger = new Logger(AgentHealthService.name);

  constructor(
    private readonly repo: AgentConfigRepository,
    private readonly config: AgentConfigService,
  ) {}

  /**
   * Runs at 00:00 on the 1st of every month. Only touches the pooled-agent
   * usage counters — a personal BYOK user's usage counters (in
   * UserSettingsService) have no equivalent reset anywhere in the app.
   */
  @Cron('0 0 1 * *')
  async resetMonthlyUsage(): Promise<void> {
    await this.config.resetAllUsage();
    this.logger.log('monthly token usage counters reset');
    writeHealthLog(['monthly token usage counters reset']);
  }

  /**
   * Runs every minute. For each non-disabled, non-cooling-down agent: fires
   * a real live probe against its provider, flips its status active<->expired
   * based on the result, and — notably — also checks that the *configured
   * model* still appears in the provider's live model list, so a deprecated
   * or renamed model gets caught even if the API key itself is still valid.
   *
   * This loop is sequential (a `for...of` with `await` inside each
   * iteration), not parallel — see PROBE_TIMEOUT_MS's comment above for what
   * that means for total run time with many configured agents.
   */
  @Cron('* * * * *') // every minutes
  async checkAllAgents(): Promise<void> {
    const config = await this.config.getConfig();
    if (!config?.agents?.length) {
      writeHealthLog(['run skipped: no agents configured']);
      return;
    }
    const previousCurrentAgentId = config.currentAgentId;

    let checked = 0;
    let skipped = 0;
    const changes: string[] = [];

    for (const agent of config.agents) {
      // Manually disabled agents are never probed at all — an admin
      // deliberately took them out of rotation.
      if (agent.status === 'disabled') {
        skipped++;
        continue;
      }
      // An agent still cooling down from a recent rate limit isn't probed
      // either — no point spending a health-check call while we already
      // know to wait.
      if (isCooldownActive(agent.cooldownUntil)) {
        skipped++;
        continue;
      }
      checked++;

      const healthy = await this.probeProvider(
        agent.provider,
        agent.apiKey,
        agent.model,
      );
      const nextStatus: AgentStatus = healthy ? 'active' : 'expired';

      // Only write (and log) anything if the status actually changed —
      // avoids a Mongo write + log line every single minute for every
      // already-healthy agent.
      if (agent.status !== nextStatus) {
        const previousStatus = agent.status;
        await this.repo.updateRuntime(agent.id, {
          status: nextStatus,
          // Recovering to 'active' also clears any stale cooldown/failure
          // reason left over from whatever caused the earlier problem.
          ...(nextStatus === 'active'
            ? { cooldownUntil: null, lastFailureReason: '' }
            : {}),
        });
        // Mutate the in-memory copy too so the currentAgentId re-sync below
        // (which reads from this same `config` object) sees the fresh
        // status without needing to re-fetch from the database.
        agent.status = nextStatus;
        if (nextStatus === 'active') {
          agent.cooldownUntil = null;
          agent.lastFailureReason = '';
        }
        const line = `agent [${agent.provider}/${agent.model}]: ${previousStatus} -> ${nextStatus}`;
        this.logger.log(line);
        changes.push(line);
      }
    }

    // After processing every agent, re-check whether the previously-current
    // agent is still eligible — a status flip above might have just taken it
    // out of rotation.
    const nextCurrentAgentId = await this.config.syncCurrentAgent(config);
    let switchLine: string | null = null;
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
      switchLine = `current agent switched: ${previousLabel} -> ${nextLabel}`;
      this.logger.log(switchLine);
    }

    writeHealthLog([
      `run summary: checked=${checked} skipped=${skipped} changes=${changes.length}`,
      ...changes,
      ...(switchLine ? [switchLine] : []),
    ]);
  }

  /**
   * On-demand version of the per-agent check inside checkAllAgents() above,
   * for a single agent — used right after an admin saves an edit to the
   * pooled-agent config (AgentConfigController.save() calls checkAllAgents()
   * directly rather than this, but this method exists for callers that only
   * want to verify one specific agent without touching the rest of the pool).
   */
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

  /**
   * The actual live network probe for one provider/key/model combination.
   * Reuses the same request-shape builder as user-facing settings validation
   * (buildProviderValidationRequest) — a lightweight "/models"-style call
   * that doesn't spend any real generation tokens.
   *
   * Returns true = healthy/keep as active, false = mark expired. Note this
   * is deliberately permissive on ambiguous outcomes (network errors, 5xx,
   * an unrecognized provider) — it only returns false when there's a
   * concrete signal the key/model is actually bad, never on "couldn't tell".
   */
  private async probeProvider(
    provider: string,
    apiKey: string,
    model?: string,
  ): Promise<boolean> {
    const request = buildProviderValidationRequest(provider, apiKey);
    // Unrecognized provider — nothing to probe against, so don't penalize it.
    if (!request) return true;

    try {
      const res = await fetch(request.url, {
        headers: request.headers,
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });

      if (res.status === 429) {
        // A 429 alone doesn't mean the key is bad — only a genuinely
        // exhausted quota (matched against known phrasing in the body) does.
        // A plain transient rate limit is treated as still healthy.
        const body = await res.text().catch(() => '');
        return !isQuotaExhausted(body);
      }

      // Any other 4xx (401/403/404 etc.) means the provider rejected this
      // exact key/request outright — treat as unhealthy.
      if (res.status >= 400 && res.status < 500) return false;

      // 5xx or a network-level failure below is ambiguous ("provider is
      // having a bad day", not "this key is bad") — don't punish the agent
      // for it.
      if (!res.ok) return true;
      if (!model?.trim()) return true;

      const payload = await res.json().catch(() => null);
      if (!payload) return true;

      // Beyond "is the key valid", also confirm the *specific configured
      // model* still exists in this provider's live catalogue — catches
      // deprecated/renamed models even when auth itself is fine.
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
      // Network error / timeout — ambiguous, don't penalize.
      return true;
    }
  }
}
