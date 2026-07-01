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

import { PipelineService } from './pipeline.service';
import { MemoryService } from '../memory/memory.service';
import { UserSettingsService } from '../user-settings/user-settings.service';
import { AgentConfigService, type ResolvedConfig } from '../agent-config/agent-config.service';
import type { ExecuteResult, LlmOpts } from './pipeline.service';

interface AccessResult {
  apiKey:            string;
  model?:            string;
  provider?:         string;
  maxTokens:         number;
  inputTokenLimit?:  number;
  agentApiKey?:      string;
  lastInputTokens?:  number;
  source:            'personal' | 'agent';
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

export interface LimitWarning {
  usedTokens:   number;
  currentLimit: number;
  suggestedLimit: number;
}

export interface ResponseConnectionInfo {
  source:            'personal' | 'agent';
  provider?:         string;
  model?:            string;
  agentApiKey?:      string;
  outputTokenLimit?: number;
  inputTokenLimit?:  number;
}

export interface AnalyticsResponse {
  intent:               string;
  sessionId:            string;
  messageId:            string;
  inputTokens:          number;
  outputTokens:         number;
  connection?:          ResponseConnectionInfo;
  tokenLimitExceeded?:  boolean;
  outputLimitWarning?:  LimitWarning;
  inputLimitWarning?:   LimitWarning;
  [key: string]:        unknown;
}

// ── Error classification ───────────────────────────────────────────────────────

const ERROR_CODES = {
  INVALID_API_KEY:           'INVALID_API_KEY',
  LLM_RATE_LIMIT:            'LLM_RATE_LIMIT',
  TOKEN_LIMIT_TOO_LOW:       'TOKEN_LIMIT_TOO_LOW',
  INPUT_TOKEN_LIMIT_TOO_LOW: 'INPUT_TOKEN_LIMIT_TOO_LOW',
  NO_ACTIVE_CONNECTION:      'NO_ACTIVE_CONNECTION',
} as const;

const MIN_SUMMARY_LENGTH_FOR_MEMORY = 30;
const REQUEST_BASE_OVERHEAD_TOKENS = 512;

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

function isFreeTierExhausted(err: unknown): boolean {
  const msg = getErrorMessage(err).toLowerCase();
  return (
    msg.includes('free_tier') ||
    msg.includes('free tier') ||
    (msg.includes('limit: 0') && msg.includes('quota')) ||
    (msg.includes('resource_exhausted') && msg.includes('per_day')) ||
    (msg.includes('resource_exhausted') && msg.includes('daily')) ||
    (msg.includes('tokens per day') && msg.includes('limit'))
  );
}

function extractRetryDelay(err: unknown): string | null {
  const message = getErrorMessage(err);
  const secsMatch = /(?:try\s+again|retry)\s+in\s+([\d.]+)\s*s/i.exec(message);
  if (secsMatch) {
    const secs = parseFloat(secsMatch[1]);
    if (!isNaN(secs)) return secs < 60 ? `${Math.ceil(secs)}s` : `${Math.ceil(secs / 60)}m`;
  }
  const compoundMatch = /(?:try\s+again|retry)\s+in\s+(\d+)m([\d.]+)s/i.exec(message);
  if (compoundMatch) {
    const totalMins = parseInt(compoundMatch[1], 10) + parseFloat(compoundMatch[2]) / 60;
    return `${Math.ceil(totalMins)}m`;
  }
  return null;
}

function isStructuredOutputUnsupportedError(err: unknown): boolean {
  const msg = getErrorMessage(err).toLowerCase();
  return (
    msg.includes('does not support response format') ||
    (msg.includes('not support') && msg.includes('json_schema')) ||
    (msg.includes('response format') && msg.includes('not support'))
  );
}

function isModelNotFoundError(err: unknown): boolean {
  const msg = getErrorMessage(err).toLowerCase();
  return (
    msg.includes('is not found for api version') ||
    msg.includes('is not supported for generatecontent') ||
    msg.includes('model not found') ||
    msg.includes('does not exist') ||
    msg.includes('no such model') ||
    (msg.includes('404') && msg.includes('model'))
  );
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

function isTruncatedOutputError(err: unknown): boolean {
  if (isStructuredOutputUnsupportedError(err)) return false;
  const msg = getErrorMessage(err).toLowerCase();
  return (
    msg.includes('unexpected end of json') ||
    msg.includes('unterminated string') ||
    (msg.includes('syntaxerror') && (msg.includes('unexpected end') || msg.includes('unexpected token'))) ||
    (msg.includes('invalid json') && (msg.includes('unexpected') || msg.includes('unterminated'))) ||
    msg.includes('failed_generation') ||   // Groq: JSON cut off before completion
    msg.includes('no object generated')    // Vercel AI SDK NoObjectGeneratedError
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

    const { sessionId, displayIntent } = await this.resolveSession({ ...req, intent });
    const memoryContext = await this.buildMemoryContext(
      req.userId, sessionId, prompt,
    );
    const minimumInputTokens = this.estimateMinimumInputTokens(prompt, memoryContext);

    this.logger.log(`prompt: "${prompt}" | intent: ${intent ?? 'auto'} | session: ${sessionId}`);
    const t0 = Date.now();

    const triedAgentKeys: string[] = [];
    let access!: AccessResult;
    let result: unknown;
    let inputTokens  = 0;
    let outputTokens = 0;

    agentLoop: for (;;) {
      access = this.resolveAccess(
        userKey, userModel, userProvider, agentCfg,
        settings?.responseTokenLimit ?? settings?.inputTokenLimit,
        minimumInputTokens,
        triedAgentKeys,
      );

      if (access.inputTokenLimit) {
        const estimatedTokens = Math.max(minimumInputTokens, access.lastInputTokens ?? 0);
        if (estimatedTokens > access.inputTokenLimit) {
          const currentLimit   = access.inputTokenLimit;
          const suggestedLimit = Math.min(128_000, estimatedTokens * 2);
          const estimateBasis  = access.lastInputTokens && access.lastInputTokens > minimumInputTokens
            ? 'recent successful request size'
            : 'minimum request size';
          throw new HttpException(
            {
              error:         `Estimated request size (~${estimatedTokens.toLocaleString()} tokens based on ${estimateBasis}) exceeds this connection's input limit (${currentLimit.toLocaleString()} tokens).`,
              code:          ERROR_CODES.INPUT_TOKEN_LIMIT_TOO_LOW,
              currentLimit,
              suggestedLimit,
              agentApiKey:   access.agentApiKey,
            },
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
      }

      let context = memoryContext;
      for (;;) {
        try {
          const executed = await this.executeByIntent(intent, prompt, context, {
            apiKey:    access.apiKey,
            model:     access.model,
            provider:  access.provider,
            maxTokens: access.maxTokens,
          });
          result       = executed.result;
          inputTokens  = executed.usage.inputTokens;
          outputTokens = executed.usage.outputTokens;
          break agentLoop;
        } catch (err) {
          if (isContextLengthError(err) && context.length > 0) {
            const drop = Math.max(1, Math.ceil(context.length / 2));
            this.logger.warn(`context too long — dropping oldest ${drop} message(s) and retrying`);
            context = context.slice(drop);
            continue;
          }
          if (isStructuredOutputUnsupportedError(err)) {
            throw new BadRequestException(
              'This model does not support structured outputs required by this app. ' +
              'Please choose a model that supports structured or JSON outputs for this provider, then try again.',
            );
          }
          if (isModelNotFoundError(err)) {
            if (access.agentApiKey) {
              void this.agentConfig.updateStatus(access.agentApiKey, 'expired');
              triedAgentKeys.push(access.agentApiKey);
              this.logger.warn(`agent [${access.provider}/${access.model}] model not found — trying next agent`);
              continue agentLoop;
            }
            throw new BadRequestException(
              'Model not found or no longer supported. Please open Settings and select a valid model for your provider.',
            );
          }
          if (isInvalidKeyError(err)) {
            if (access.agentApiKey) {
              void this.agentConfig.updateStatus(access.agentApiKey, 'expired');
              triedAgentKeys.push(access.agentApiKey);
              this.logger.warn(`agent [${access.provider}/${access.model}] invalid key — trying next agent`);
              continue agentLoop;
            }
            throw Object.assign(
              new UnauthorizedException('Invalid API key. Please update it in Settings or Agent Config.'),
              { code: ERROR_CODES.INVALID_API_KEY },
            );
          }
          if (isProviderRateLimitError(err)) {
            const exhausted = isFreeTierExhausted(err);
            if (access.agentApiKey) {
              void this.agentConfig.updateStatus(access.agentApiKey, exhausted ? 'expired' : 'idle');
              triedAgentKeys.push(access.agentApiKey);
              this.logger.warn(`agent [${access.provider}/${access.model}] rate-limited — trying next agent`);
              continue agentLoop;
            }
            // Personal key — no failover possible
            const retryIn = extractRetryDelay(err);
            const msg = exhausted
              ? `The current quota for ${access.provider ?? 'this provider'} is exhausted. ` +
                'Try another model, use a different key, or enable billing for this provider account.'
              : retryIn
                ? `Rate limit reached. Try again in ${retryIn}.`
                : 'Rate limit reached. Please try again in a moment.';
            throw Object.assign(
              new HttpException({ error: msg }, HttpStatus.TOO_MANY_REQUESTS),
              { code: ERROR_CODES.LLM_RATE_LIMIT },
            );
          }
          if (isTruncatedOutputError(err)) {
            const currentLimit   = access.maxTokens;
            const suggestedLimit = Math.min(32_000, Math.max(8_000, currentLimit * 2));
            throw new HttpException(
              {
                error:         `Your response token limit (${currentLimit.toLocaleString()} tokens) is too low — the AI response was cut off before it could finish.`,
                code:          ERROR_CODES.TOKEN_LIMIT_TOO_LOW,
                currentLimit,
                suggestedLimit,
                agentApiKey:   access.agentApiKey,
              },
              HttpStatus.UNPROCESSABLE_ENTITY,
            );
          }
          throw err;
        }
      }
    }

    const durationMs = Date.now() - t0;
    this.logger.log(`done in ${durationMs}ms | in:${inputTokens} out:${outputTokens}`);

    // Persist token usage (fire-and-forget) — agent budget or personal-key counter
    if (access.agentApiKey) {
      void this.agentConfig.trackUsage(access.agentApiKey, inputTokens, outputTokens);
      // Record actual token cost so the next pre-flight check uses real data
      void this.agentConfig.updateLastInputTokens(access.agentApiKey, inputTokens);
    } else {
      void this.userSettings.incrementUsage(req.userId, inputTokens, outputTokens);
    }

    return this.buildResponse({
      result, prompt, apiKey: access.apiKey, sessionId,
      displayIntent, userId: req.userId, durationMs,
      inputTokens, outputTokens,
      outputTokenLimit: access.maxTokens,
      inputTokenLimit:  access.inputTokenLimit,
      agentApiKey: access.agentApiKey,
      source: access.source,
      model: access.model, provider: access.provider,
    });
  }

  private resolveAccess(
    userKey:          string | null,
    userModel:        string | undefined,
    userProvider:     string | undefined,
    agentCfg:         ResolvedConfig,
    userTokenLimit?:  number,
    minimumInputTokens = 0,
    excludeApiKeys:   string[] = [],
  ): AccessResult {
    if (userKey) {
      return {
        apiKey:    userKey,
        model:     userModel,
        provider:  userProvider,
        maxTokens: userTokenLimit ?? 4_000,
        source:    'personal',
      };
    }

    const activeAgents = agentCfg.agents.filter(
      a => a.status === 'active' && !excludeApiKeys.includes(a.apiKey),
    );
    const active =
      activeAgents.find(a => !a.inputTokenLimit || a.inputTokenLimit >= minimumInputTokens)
      ?? activeAgents[0];

    if (active?.apiKey) {
      return {
        apiKey:           active.apiKey,
        model:            active.model,
        provider:         active.provider,
        maxTokens:        active.outputTokenLimit,
        inputTokenLimit:  active.inputTokenLimit,
        agentApiKey:      active.apiKey,
        lastInputTokens:  active.lastInputTokens,
        source:           'agent',
      };
    }

    throw Object.assign(
      new UnauthorizedException(
        'No active AI connection. Your agent may be expired, disabled, or quota-exhausted. ' +
        'Open Config to re-enable it or add a new connection.',
      ),
      { code: ERROR_CODES.NO_ACTIVE_CONNECTION },
    );
  }

  private estimateMinimumInputTokens(prompt: string, memoryContext: CoreMessage[]): number {
    const promptTokens = Math.ceil(prompt.length / 4);
    const memoryTokens = memoryContext.reduce((sum, msg) => {
      const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      return sum + Math.ceil(text.length / 4);
    }, 0);
    return promptTokens + memoryTokens + REQUEST_BASE_OVERHEAD_TOKENS;
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
    inputTokenLimit?:   number;
    agentApiKey?:       string;
    source:             'personal' | 'agent';
    model?:             string;
    provider?:          string;
  }): AnalyticsResponse {
    const { result, prompt, apiKey, sessionId, displayIntent, userId,
            durationMs, inputTokens, outputTokens, outputTokenLimit, inputTokenLimit, agentApiKey, source, model, provider } = params;

    const tokenLimitExceeded = outputTokenLimit !== undefined && outputTokens >= outputTokenLimit;
    const outputLimitWarning: LimitWarning | undefined = tokenLimitExceeded && outputTokenLimit !== undefined
      ? { usedTokens: outputTokens, currentLimit: outputTokenLimit, suggestedLimit: Math.min(128_000, outputTokenLimit * 2) }
      : undefined;

    const inputLimitExceeded = inputTokenLimit !== undefined && inputTokens > inputTokenLimit;
    const inputLimitWarning: LimitWarning | undefined  = inputLimitExceeded && inputTokenLimit !== undefined
      ? { usedTokens: inputTokens, currentLimit: inputTokenLimit, suggestedLimit: Math.min(128_000, inputTokens * 2) }
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

    const tokenFields = {
      connection: {
        source,
        provider,
        model,
        agentApiKey,
        outputTokenLimit,
        inputTokenLimit,
      },
      ...(tokenLimitExceeded ? { tokenLimitExceeded } : {}),
      ...(outputLimitWarning ? { outputLimitWarning } : {}),
      ...(inputLimitWarning  ? { inputLimitWarning  } : {}),
    };

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
