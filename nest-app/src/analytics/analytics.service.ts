import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { CoreMessage } from 'ai';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { getSources } from '../sources/sources-cache';
import { PipelineService } from './pipeline.service';
import { MemoryService } from '../memory/memory.service';
import { UserSettingsService } from '../user-settings/user-settings.service';
import { AgentConfigService, type ResolvedConfig } from '../agent-config/agent-config.service';
import type { ExecuteResult, LlmOpts } from './pipeline.service';

interface AccessResult {
  apiKey:       string;
  model?:       string;
  provider?:    string;
  maxTokens:    number;    // max output tokens sent to LLM; warning fires when response hits this cap
  agentApiKey?: string;
}
import {
  sessionExists,
  ensureThread,
  getMemoryContext,
  saveConversationTurn,
  type SessionIntent,
  type MessageResult,
  type ConversationMessage,
} from '../session/memory';

// ── Prompt validation ──────────────────────────────────────────────────────────

const promptSchema = z.string()
  .min(1, 'Prompt is required')
  .max(1000, 'Prompt must be 1000 characters or fewer');

// ── Types ──────────────────────────────────────────────────────────────────────

type ResolvedType = 'dashboard' | 'report' | 'inquiry';

export interface AnalyticsRequest {
  prompt:    string;
  intent?:   string;
  sessionId?: string | null;
  userId:    string;
}

export interface AnalyticsResponse {
  intent:              string;
  sessionId:           string;
  messageId:           string;
  inputTokens:         number;
  outputTokens:        number;
  tokenLimitExceeded?: boolean;
  tokenWarning?:       string;
  [key: string]:       unknown;
}

// ── Error classification ───────────────────────────────────────────────────────

const ERROR_CODES = {
  INVALID_API_KEY: 'INVALID_API_KEY',
  LLM_RATE_LIMIT:  'LLM_RATE_LIMIT',
} as const;

const MIN_SUMMARY_LENGTH_FOR_MEMORY = 30;

function getErrorStatus(err: unknown): number | undefined {
  return (err as { statusCode?: number; status?: number }).statusCode
    ?? (err as { status?: number }).status;
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isInvalidKeyError(err: unknown): boolean {
  const status = getErrorStatus(err);
  if (status === 401 || status === 403) return true;
  const msg = getErrorMessage(err).toLowerCase();
  return (
    msg.includes('401') ||
    msg.includes('403') ||
    msg.includes('invalid_api_key') ||
    msg.includes('invalid api key') ||
    msg.includes('incorrect api key') ||
    msg.includes('authentication') ||
    msg.includes('api key')
  );
}

function isProviderRateLimitError(err: unknown): boolean {
  const status = getErrorStatus(err);
  if (status === 429) return true;
  const msg = getErrorMessage(err).toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('tokens per day') ||
    msg.includes('tpm') ||
    msg.includes('rpm') ||
    msg.includes('service tier') ||
    msg.includes('quota')
  );
}

function extractRetryDelay(err: unknown): string | null {
  // Handles Groq "try again in 30s", Google "Please retry in 45.15s", OpenAI "Try again in 60s"
  const match = /(?:try\s+again|retry)\s+in\s+([\d.]+)\s*s/i.exec(getErrorMessage(err));
  if (!match) return null;
  const secs = parseFloat(match[1]);
  if (isNaN(secs)) return null;
  return secs < 60 ? `${Math.ceil(secs)}s` : `${Math.ceil(secs / 60)}m`;
}

function isContextLengthError(err: unknown): boolean {
  const msg = getErrorMessage(err).toLowerCase();
  return (
    msg.includes('context_length_exceeded') ||
    msg.includes('context length') ||
    msg.includes('maximum context') ||
    msg.includes('max_tokens') ||
    msg.includes('too many tokens') ||
    msg.includes('reduce your prompt') ||
    msg.includes('tokens per request') ||
    msg.includes('input is too long') ||
    msg.includes('prompt is too long') ||
    getErrorStatus(err) === 413
  );
}


@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly pipeline:     PipelineService,
    private readonly memory:       MemoryService,
    private readonly userSettings: UserSettingsService,
    private readonly agentConfig:  AgentConfigService,
  ) {}


  private async executeByIntent(
    intent:        string | undefined,
    prompt:        string,
    memoryContext: CoreMessage[],
    opts:          LlmOpts,
  ): Promise<ExecuteResult<unknown>> {
    switch (intent) {
      case 'dashboard': return this.pipeline.executeDashboard(prompt, memoryContext, opts);
      case 'report':    return this.pipeline.executeReport(prompt, memoryContext, opts);
      case 'inquiry':   return this.pipeline.executeInquiry(prompt, memoryContext, opts);
      default:          return this.pipeline.execute(prompt, memoryContext, opts);
    }
  }


  async run(req: AnalyticsRequest): Promise<AnalyticsResponse> {
    const prompt = promptSchema.parse(req.prompt);
    const intent = req.intent;

    const [settings, agentCfg] = await Promise.all([
      this.userSettings.findByUser(req.userId),
      this.agentConfig.getConfig(),
    ]);

    const userKey      = settings?.apiKey?.trim()    || null;
    const userModel    = settings?.model?.trim()     || undefined;
    const userProvider = settings?.provider?.trim()  || undefined;

    if (settings && (!userKey || !userProvider || !userModel)) {
      throw new BadRequestException(
        'Incomplete setup: please provide a valid API key, provider, and model in Settings.',
      );
    }

    const access = this.resolveAccess(userKey, userModel, userProvider, agentCfg,
      settings?.inputTokenLimit);

    const { sessionId, displayIntent } = await this.resolveSession({ ...req, intent });
    const memoryContext = await this.buildMemoryContext(
      req.userId, sessionId, prompt,
    );

    this.logger.log(`prompt: "${prompt}" | intent: ${intent ?? 'auto'} | session: ${sessionId}`);
    const t0 = Date.now();

    let result: unknown;
    let inputTokens  = 0;
    let outputTokens = 0;
    let context      = memoryContext;
    for (;;) {
      try {
        const executed = await this.executeByIntent(intent, prompt, context, {
          apiKey: access.apiKey, model: access.model, provider: access.provider, maxTokens: access.maxTokens,
        });
        result       = executed.result;
        inputTokens  = executed.usage.inputTokens;
        outputTokens = executed.usage.outputTokens;
        break;
      } catch (err) {
        if (isContextLengthError(err) && context.length > 0) {
          const drop = Math.max(1, Math.ceil(context.length / 2));
          this.logger.warn(`context too long — dropping oldest ${drop} message(s) and retrying`);
          context = context.slice(drop);
          continue;
        }
        if (isInvalidKeyError(err)) {
          throw Object.assign(
            new UnauthorizedException('Invalid API key. Please update it in Settings or Agent Config.'),
            { code: ERROR_CODES.INVALID_API_KEY },
          );
        }
        if (isProviderRateLimitError(err)) {
          const retryIn = extractRetryDelay(err);
          const msg = retryIn
            ? `API quota reached. Try again in ${retryIn}.`
            : 'API quota reached. Please try again later.';
          throw Object.assign(
            new HttpException({ error: msg }, HttpStatus.TOO_MANY_REQUESTS),
            { code: ERROR_CODES.LLM_RATE_LIMIT },
          );
        }
        throw err;
      }
    }

    const durationMs = Date.now() - t0;
    this.logger.log(`done in ${durationMs}ms | in:${inputTokens} out:${outputTokens}`);

    // Persist token usage (fire-and-forget) — agent budget or personal-key counter
    if (access.agentApiKey) {
      void this.agentConfig.trackUsage(access.agentApiKey, inputTokens, outputTokens);
    } else {
      void this.userSettings.incrementUsage(req.userId, inputTokens, outputTokens);
    }

    return this.buildResponse({
      result, prompt, apiKey: access.apiKey, sessionId,
      displayIntent, userId: req.userId, durationMs,
      inputTokens, outputTokens, outputTokenLimit: access.maxTokens,
      agentApiKey: access.agentApiKey,
      model: access.model, provider: access.provider,
    });
  }

  private resolveAccess(
    userKey:         string | null,
    userModel:       string | undefined,
    userProvider:    string | undefined,
    agentCfg:        ResolvedConfig,
    userTokenLimit?: number,
  ): AccessResult {
    if (userKey) {
      return {
        apiKey:     userKey,
        model:      userModel,
        provider:   userProvider,
        maxTokens:  userTokenLimit ?? 4_000,
      };
    }
    const active = agentCfg.agents.find(a => a.status === 'active');
    if (active?.apiKey) {
      return {
        apiKey:       active.apiKey,
        model:        active.model,
        provider:     active.provider,
        maxTokens:    active.outputTokenLimit,
        agentApiKey:  active.apiKey,
      };
    }
    throw new UnauthorizedException(
      'No API key configured. Add one in Settings or configure an active agent in Agent Config.',
    );
  }

  private async resolveSession(req: AnalyticsRequest): Promise<{
    sessionId: string;
    displayIntent: SessionIntent;
  }> {
    const displayIntent = this.toDisplayIntent(req.intent);
    const requested =
      typeof req.sessionId === 'string' && req.sessionId.trim()
        ? req.sessionId.trim()
        : null;
    const sessionId =
      requested && (await sessionExists(requested)) ? requested : randomUUID();
    await ensureThread(sessionId, req.prompt, displayIntent);
    return { sessionId, displayIntent };
  }

  private toDisplayIntent(intent: string | undefined): SessionIntent {
    if (intent === 'dashboard') return 'dashboard';
    if (intent === 'report')    return 'report';
    return 'inquiry';
  }

  private async buildMemoryContext(
    userId:    string,
    sessionId: string,
    prompt:    string,
  ): Promise<CoreMessage[]> {
    const sessionContext = await getMemoryContext(sessionId);
    const longTerm       = await this.memory.getRelevantContext(userId, prompt);

    const longTermMessages: CoreMessage[] = longTerm
      ? [
          { role: 'user',      content: `[Long-term memory from previous sessions]\n${longTerm}` },
          { role: 'assistant', content: 'Noted. I will use this context.' },
        ]
      : [];

    return [...longTermMessages, ...sessionContext];
  }

  // ── Response building ────────────────────────────────────────────────────────

  private resolveType(result: unknown): ResolvedType {
    if (result && typeof result === 'object' && 'widgets' in result)        return 'dashboard';
    if (result && typeof result === 'object' && 'reportSections' in result) return 'report';
    return 'inquiry';
  }

  private toMessageResult(type: ResolvedType, result: unknown, durationMs: number): MessageResult {
    const r = result as Record<string, unknown>;
    switch (type) {
      case 'dashboard':
        return { type: 'dashboard', dashboardSpec: result as MessageResult['dashboardSpec'], durationMs };
      case 'report':
        return { type: 'report', reportSections: (r.reportSections as MessageResult['reportSections']) ?? [], durationMs };
      case 'inquiry':
        return { type: 'inquiry', summary: (r.summary as string) ?? '', durationMs };
    }
  }

  private buildResponseSummary(type: ResolvedType, prompt: string, result: unknown): string {
    const r = result as Record<string, unknown>;
    if (type === 'inquiry') return (r.summary as string) ?? '';
    if (type === 'report')  return `Report generated: ${prompt}`;
    return `Dashboard generated: ${prompt}`;
  }

  private buildResponse(params: {
    result:             unknown;
    prompt:             string;
    apiKey:             string;
    sessionId:          string;
    displayIntent:      SessionIntent;
    userId:             string;
    durationMs:         number;
    inputTokens:        number;
    outputTokens:       number;
    outputTokenLimit?:  number;
    agentApiKey?:       string;
    model?:             string;
    provider?:          string;
  }): AnalyticsResponse {
    const { result, prompt, apiKey, sessionId, displayIntent, userId,
            durationMs, inputTokens, outputTokens, outputTokenLimit, agentApiKey, model, provider } = params;

    const tokenLimitExceeded = outputTokenLimit !== undefined && outputTokens >= outputTokenLimit;
    const tokenWarning = tokenLimitExceeded
      ? `Response reached your configured token limit (${outputTokens}/${outputTokenLimit}). ` +
        `The answer may be incomplete. Do you wish to continue with a higher limit?`
      : undefined;
    const type          = this.resolveType(result);
    const messageResult = this.toMessageResult(type, result, durationMs);
    const messageId     = randomUUID();

    const assistantMessage: ConversationMessage & { role: 'assistant'; result: MessageResult } = {
      messageId,
      role:      'assistant',
      result:    messageResult,
      createdAt: new Date().toISOString(),
    };

    void this.persistTurn({ sessionId, prompt, displayIntent, assistantMessage });
    void this.maybeExtractMemory({ type, prompt, result, userId, sessionId, apiKey, agentApiKey, model, provider });

    const tokenFields = tokenLimitExceeded ? { tokenLimitExceeded, tokenWarning } : {};

    if (type === 'dashboard') {
      return { intent: 'dashboard', chart: result, sessionId, messageId, inputTokens, outputTokens, ...tokenFields };
    }
    return { intent: type, ...(result as object), sessionId, messageId, inputTokens, outputTokens, ...tokenFields };
  }

  private async persistTurn(params: {
    sessionId:        string;
    prompt:           string;
    displayIntent:    SessionIntent;
    assistantMessage: ConversationMessage & { role: 'assistant'; result: MessageResult };
  }): Promise<void> {
    try {
      await saveConversationTurn({
        threadId: params.sessionId,
        prompt:   params.prompt,
        intent:   params.displayIntent,
        assistant: params.assistantMessage,
      });
    } catch (err) {
      this.logger.error(`saveConversationTurn failed: ${err}`);
    }
  }

  private async maybeExtractMemory(params: {
    type:          ResolvedType;
    prompt:        string;
    result:        unknown;
    userId:        string;
    sessionId:     string;
    apiKey:        string;
    agentApiKey?:  string;
    model?:        string;
    provider?:     string;
  }): Promise<void> {
    const summary = this.buildResponseSummary(params.type, params.prompt, params.result);
    if (summary.length <= MIN_SUMMARY_LENGTH_FOR_MEMORY) return;
    try {
      const { inputTokens, outputTokens } = await this.memory.extractAndSave(
        params.userId,
        params.sessionId,
        params.prompt,
        summary,
        params.apiKey,
        params.model,
        params.provider,
      );
      // Credit memory tokens against whichever budget is active
      if (params.agentApiKey) {
        void this.agentConfig.trackUsage(params.agentApiKey, inputTokens, outputTokens);
      } else {
        void this.userSettings.incrementUsage(params.userId, inputTokens, outputTokens);
      }
    } catch (err) {
      this.logger.warn(`memory.extractAndSave failed: ${err}`);
    }
  }
}
