import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { CoreMessage } from 'ai';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { getSources } from '../sources/sources-cache';
import { UserKeysService } from '../user-keys/user-keys.service';
import { PipelineService } from './pipeline.service';
import { MemoryService } from '../memory/memory.service';
import { analyticsAgent } from '../session/agent';
import {
  sessionExists,
  ensureThread,
  getMemoryContext,
  saveConversationTurn,
  type SessionIntent,
  type MessageResult,
  type ConversationMessage,
} from '../session/memory';

// ============================================================================
// Constants & Schemas
// ============================================================================

const promptSchema = z.string()
  .min(1, 'Prompt is required')
  .max(1000, 'Prompt must be 1000 characters or fewer');

type ResolvedType = 'dashboard' | 'report' | 'inquiry';

const MIN_SUMMARY_LENGTH_FOR_MEMORY = 30;
const MAX_AGENT_STEPS = 2;

const ERROR_CODES = {
  INVALID_API_KEY: 'INVALID_API_KEY',
  LLM_RATE_LIMIT: 'LLM_RATE_LIMIT',
} as const;

// ============================================================================
// Error classification helpers
// ============================================================================

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
  const match = /try again in\s+([^.]+(?:\.\d+s)?)/i.exec(getErrorMessage(err));
  return match?.[1]?.trim() ?? null;
}

function buildRateLimitMessage(err: unknown, withKeyHint: boolean): string {
  const retryIn = extractRetryDelay(err);
  const suffix = withKeyHint ? ' or use a different API key.' : '.';
  if (retryIn) return `API quota reached. Try again in ${retryIn}${suffix}`;
  return withKeyHint
    ? 'API quota reached. Please try again later or use a different API key.'
    : 'API quota reached. Please try again later.';
}

// ============================================================================
// Types
// ============================================================================

export interface AnalyticsRequest {
  prompt: string;
  intent?: string;
  sessionId?: string | null;
  userId: string;
}

export interface AnalyticsResponse {
  intent: string;
  sessionId: string;
  messageId: string;
  [key: string]: unknown;
}

// ============================================================================
// Service
// ============================================================================

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly pipeline: PipelineService,
    private readonly userKeys: UserKeysService,
    private readonly cfg: ConfigService,
    private readonly memory: MemoryService,
  ) {}

  // --------------------------------------------------------------------------
  // Intent execution
  // --------------------------------------------------------------------------

  private async executeByIntent(
    intent: string | undefined,
    prompt: string,
    memoryContext: CoreMessage[],
    apiKey: string,
  ): Promise<unknown> {
    switch (intent) {
      case 'dashboard':
        return this.pipeline.executeDashboard(prompt, memoryContext, apiKey);
      case 'report':
        return this.pipeline.executeReport(prompt, memoryContext, apiKey);
      case 'inquiry':
      case 'general_question':
        return this.pipeline.executeInquiry(prompt, memoryContext, apiKey);
      default:
        return this.executeFreeText(prompt);
    }
  }

  private async executeFreeText(prompt: string): Promise<unknown> {
    this.logger.log('no intent — routing through analyticsAgent');
    const agentResponse = await analyticsAgent.generateLegacy(
      [{ role: 'user', content: prompt }],
      { maxSteps: MAX_AGENT_STEPS },
    );
    const toolResult = agentResponse.toolResults?.[0];
    return toolResult?.result ?? { summary: agentResponse.text ?? 'No result.' };
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  async run(req: AnalyticsRequest): Promise<AnalyticsResponse> {
    const prompt = promptSchema.parse(req.prompt);

    this.ensureDataSources();
    const { storedKey, globalKey, primaryKey } = await this.resolveApiKeys(req.userId);
    const { sessionId, displayIntent } = await this.resolveSession(req);

    const memoryContext = await this.buildMemoryContext(req.userId, sessionId, prompt);

    this.logger.log(
      `prompt: "${prompt}" | intent: ${req.intent ?? 'free-text'} | session: ${sessionId}`,
    );
    const t0 = Date.now();
    const { result, effectiveApiKey } = await this.runWithFallback(
      req.intent,
      prompt,
      memoryContext,
      primaryKey,
      storedKey,
      globalKey,
      req.userId,
    );
    this.logger.log(`done in ${Date.now() - t0}ms`);

    return this.buildResponse({
      result,
      prompt,
      effectiveApiKey,
      sessionId,
      displayIntent,
      userId: req.userId,
      durationMs: Date.now() - t0,
    });
  }

  // --------------------------------------------------------------------------
  // Setup helpers
  // --------------------------------------------------------------------------

  private ensureDataSources(): void {
    if (!getSources().length) {
      throw new BadRequestException('No data sources configured. Run the seed script first.');
    }
  }

  private async resolveApiKeys(userId: string): Promise<{
    storedKey: string | null;
    globalKey: string | null;
    primaryKey: string;
  }> {
    const storedKey  = (await this.userKeys.get(userId))?.trim() || null;
    const groqGlobal = this.cfg.get<string>('llm.groqApiKey')?.trim() || null;
    const openaiGlobal = this.cfg.get<string>('llm.openaiApiKey')?.trim() || null;
    const globalKey  = groqGlobal || openaiGlobal || null;
    const primaryKey = storedKey || globalKey;

    if (!primaryKey) {
      throw new UnauthorizedException(
        'No API key configured. Please enter a valid Groq or OpenAI API key in settings.',
      );
    }

    return { storedKey, globalKey, primaryKey };
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
    if (intent === 'report') return 'report';
    return 'inquiry';
  }

  private async buildMemoryContext(
    userId: string,
    sessionId: string,
    prompt: string,
  ): Promise<CoreMessage[]> {
    const sessionContext = await getMemoryContext(sessionId);
    const longTerm = await this.memory.getRelevantContext(userId, prompt);
    if (!longTerm) return sessionContext;
    return [
      {
        role: 'user',
        content: `[Long-term memory from previous sessions]\n${longTerm}`,
      },
      { role: 'assistant', content: 'Noted. I will use this context.' },
      ...sessionContext,
    ];
  }

  // --------------------------------------------------------------------------
  // Execution with key fallback
  // --------------------------------------------------------------------------

  private async runWithFallback(
    intent: string | undefined,
    prompt: string,
    memoryContext: CoreMessage[],
    primaryKey: string,
    storedKey: string | null,
    globalKey: string | null,
    userId: string,
  ): Promise<{ result: unknown; effectiveApiKey: string }> {
    try {
      const result = await this.executeByIntent(intent, prompt, memoryContext, primaryKey);
      return { result, effectiveApiKey: primaryKey };
    } catch (err) {
      return this.handleExecutionError(err, {
        intent,
        prompt,
        memoryContext,
        storedKey,
        globalKey,
        userId,
      });
    }
  }

  private async handleExecutionError(
    err: unknown,
    ctx: {
      intent: string | undefined;
      prompt: string;
      memoryContext: CoreMessage[];
      storedKey: string | null;
      globalKey: string | null;
      userId: string;
    },
  ): Promise<{ result: unknown; effectiveApiKey: string }> {
    const { intent, prompt, memoryContext, storedKey, globalKey, userId } = ctx;
    const canFallback = !!(storedKey && globalKey && storedKey !== globalKey);

    if (isInvalidKeyError(err)) {
      if (!canFallback) {
        throw Object.assign(
          new UnauthorizedException('Invalid API key. Please update it in settings.'),
          { code: ERROR_CODES.INVALID_API_KEY },
        );
      }
      return this.retryWithGlobalKey({
        intent,
        prompt,
        memoryContext,
        userId,
        storedKey,
        globalKey: globalKey!,
        onInvalid: () => { throw Object.assign(
          new UnauthorizedException('Global API key is also invalid. Contact the administrator.'),
          { code: ERROR_CODES.INVALID_API_KEY },
        ); },
        onRateLimit: (retryErr) => { throw Object.assign(
          new HttpException(
            { error: buildRateLimitMessage(retryErr, false) },
            HttpStatus.TOO_MANY_REQUESTS,
          ),
          { code: ERROR_CODES.LLM_RATE_LIMIT },
        ); },
      });
    }

    if (isProviderRateLimitError(err)) {
      if (!canFallback) {
        throw Object.assign(
          new HttpException(
            { error: buildRateLimitMessage(err, true) },
            HttpStatus.TOO_MANY_REQUESTS,
          ),
          { code: ERROR_CODES.LLM_RATE_LIMIT },
        );
      }
      return this.retryWithGlobalKey({
        intent,
        prompt,
        memoryContext,
        userId,
        storedKey,
        globalKey: globalKey!,
        onInvalid: () => { throw Object.assign(
          new UnauthorizedException('Global API key is invalid. Contact the administrator.'),
          { code: ERROR_CODES.INVALID_API_KEY },
        ); },
        onRateLimit: (retryErr) => { throw Object.assign(
          new HttpException(
            { error: buildRateLimitMessage(retryErr ?? err, true) },
            HttpStatus.TOO_MANY_REQUESTS,
          ),
          { code: ERROR_CODES.LLM_RATE_LIMIT },
        ); },
        onOther: (retryErr) => {
          throw retryErr;
        },
      });
    }

    throw err;
  }

  private async retryWithGlobalKey(opts: {
    intent: string | undefined;
    prompt: string;
    memoryContext: CoreMessage[];
    userId: string;
    storedKey: string;
    globalKey: string;
    onInvalid: () => never;
    onRateLimit: (retryErr: unknown) => never;
    onOther?: (retryErr: unknown) => never;
  }): Promise<{ result: unknown; effectiveApiKey: string }> {
    this.logger.warn(`Per-user key for user ${opts.userId} rejected — deleting and retrying with global key`);
    void this.userKeys.delete(opts.userId).catch(() => undefined);
    try {
      const result = await this.executeByIntent(
        opts.intent,
        opts.prompt,
        opts.memoryContext,
        opts.globalKey,
      );
      return { result, effectiveApiKey: opts.globalKey };
    } catch (retryErr) {
      if (isInvalidKeyError(retryErr)) opts.onInvalid();
      if (isProviderRateLimitError(retryErr)) opts.onRateLimit(retryErr);
      if (opts.onOther) opts.onOther(retryErr);
      throw retryErr;
    }
  }

  // --------------------------------------------------------------------------
  // Response building
  // --------------------------------------------------------------------------

  private resolveType(result: unknown): ResolvedType {
    if (result && typeof result === 'object' && 'widgets' in result) return 'dashboard';
    if (result && typeof result === 'object' && 'reportSections' in result) return 'report';
    return 'inquiry';
  }

  private toMessageResult(
    type: ResolvedType,
    result: unknown,
    durationMs: number,
  ): MessageResult {
    const r = result as Record<string, unknown>;
    switch (type) {
      case 'dashboard':        return {
          type: 'dashboard',
          dashboardSpec: result as MessageResult['dashboardSpec'],
          durationMs,
        };
      case 'report':
        return {
          type: 'report',
          reportSections: (r.reportSections as MessageResult['reportSections']) ?? [],
          durationMs,
        };
      case 'inquiry':
        return {
          type: 'inquiry',
          summary: (r.summary as string) ?? '',
          durationMs,
        };
    }
  }

  private buildResponseSummary(type: ResolvedType, prompt: string, result: unknown): string {
    const r = result as Record<string, unknown>;
    if (type === 'inquiry') return (r.summary as string) ?? '';
    if (type === 'report') return `Report generated: ${prompt}`;
    return `Dashboard generated: ${prompt}`;
  }

  private buildResponse(params: {
    result: unknown;
    prompt: string;
    effectiveApiKey: string;
    sessionId: string;
    displayIntent: SessionIntent;
    userId: string;
    durationMs: number;
  }): AnalyticsResponse {
    const { result, prompt, effectiveApiKey, sessionId, displayIntent, userId, durationMs } = params;
    const type = this.resolveType(result);    const messageResult = this.toMessageResult(type, result, durationMs);
    const messageId = randomUUID();

    const assistantMessage: ConversationMessage & { role: 'assistant'; result: MessageResult } = {
      messageId,
      role: 'assistant',
      result: messageResult,
      createdAt: new Date().toISOString(),
    };

    void this.persistTurn({ sessionId, prompt, displayIntent, assistantMessage });
    void this.maybeExtractMemory({ type, prompt, result, userId, sessionId, effectiveApiKey });

    if (type === 'dashboard') {
      return { intent: 'dashboard', chart: result, sessionId, messageId };
    }
    return { intent: type, ...(result as object), sessionId, messageId };
  }

  private async persistTurn(params: {
    sessionId: string;
    prompt: string;
    displayIntent: SessionIntent;
    assistantMessage: ConversationMessage & { role: 'assistant'; result: MessageResult };
  }): Promise<void> {
    try {
      await saveConversationTurn({
        threadId: params.sessionId,
        prompt: params.prompt,
        intent: params.displayIntent,
        assistant: params.assistantMessage,
      });
    } catch (err) {
      this.logger.error(`saveConversationTurn failed: ${err}`);
    }
  }

  private async maybeExtractMemory(params: {
    type: ResolvedType;
    prompt: string;
    result: unknown;
    userId: string;
    sessionId: string;
    effectiveApiKey: string;
  }): Promise<void> {
    const summary = this.buildResponseSummary(params.type, params.prompt, params.result);
    if (summary.length <= MIN_SUMMARY_LENGTH_FOR_MEMORY) return;
    try {
      await this.memory.extractAndSave(
        params.userId,
        params.sessionId,
        params.prompt,
        summary,
        params.effectiveApiKey,
      );
    } catch (err) {
      this.logger.warn(`memory.extractAndSave failed: ${err}`);
    }
  }
}
