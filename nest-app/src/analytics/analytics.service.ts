import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getSources } from '../sources/sources-cache';
import { UserKeysService } from '../user-keys/user-keys.service';
import { PipelineService } from './pipeline.service';
import { analyticsAgent } from '../session/agent';
import {
  sessionExists, ensureThread, getMemoryContext, saveConversationTurn,
  type SessionIntent, type MessageResult, type ConversationMessage,
} from '../session/memory';

const promptSchema = z.string().min(1, 'Prompt is required').max(1000, 'Prompt must be 1000 characters or fewer');

function isInvalidKeyError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  const code = (err as { statusCode?: number; status?: number }).statusCode
    ?? (err as { status?: number }).status;
  if (code === 401 || code === 403) return true;
  return (
    msg.includes('401') || msg.includes('403') ||
    msg.includes('invalid_api_key') || msg.includes('invalid api key') ||
    msg.includes('incorrect api key') || msg.includes('authentication') ||
    msg.includes('api key')
  );
}

function isProviderRateLimitError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  const code = (err as { statusCode?: number; status?: number }).statusCode
    ?? (err as { status?: number }).status;

  if (code === 429) return true;

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
  const msg = err instanceof Error ? err.message : String(err);
  const match = /try again in\s+([^.]+(?:\.\d+s)?)/i.exec(msg);
  return match?.[1]?.trim() ?? null;
}

export interface AnalyticsRequest {
  prompt:     string;
  intent?:    string;
  sessionId?: string | null;
  userId:     string;
}

export interface AnalyticsResponse {
  intent:    string;
  sessionId: string;
  messageId: string;
  [key: string]: unknown;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly pipeline: PipelineService,
    private readonly userKeys: UserKeysService,
    private readonly cfg: ConfigService,
  ) {}

  private async executeByIntent(intent: string | undefined, prompt: string, memoryContext: string, apiKey: string): Promise<unknown> {
    if (intent === 'dashboard') {
      return this.pipeline.executeDashboard(prompt, memoryContext, apiKey);
    }
    if (intent === 'report') {
      return this.pipeline.executeReport(prompt, memoryContext, apiKey);
    }
    if (intent === 'inquiry' || intent === 'general_question') {
      return this.pipeline.executeInquiry(prompt, memoryContext, apiKey);
    }
    // Free-text — route through agent
    this.logger.log('no intent — routing through analyticsAgent');
    const agentResponse = await analyticsAgent.generateLegacy(
      [{ role: 'user', content: prompt }],
      { maxSteps: 2 },
    );
    const toolResult = agentResponse.toolResults?.[0];
    return toolResult?.result ?? { summary: agentResponse.text ?? 'No result.' };
  }

  async run(req: AnalyticsRequest): Promise<AnalyticsResponse> {
    const { userId, intent, sessionId: incoming } = req;
    const prompt = promptSchema.parse(req.prompt);

    if (!getSources().length) {
      throw new BadRequestException('No data sources configured. Run the seed script first.');
    }

    const storedKey = (await this.userKeys.get(userId))?.trim() || null;
    const globalKey = this.cfg.get<string>('llm.groqApiKey')?.trim() || null;
    const primaryKey = storedKey || globalKey;

    if (!primaryKey) {
      throw new UnauthorizedException('No API key found. Please enter your Groq API key in settings.');
    }

    const displayIntent: SessionIntent =
      intent === 'dashboard' ? 'dashboard'
      : intent === 'report'  ? 'report'
      : 'inquiry';

    const requested  = typeof incoming === 'string' && incoming.trim() ? incoming.trim() : null;
    const sessionId  = requested && await sessionExists(requested) ? requested : randomUUID();

    await ensureThread(sessionId, prompt, displayIntent);
    const memoryContext = await getMemoryContext(sessionId);

    this.logger.log(`prompt: "${prompt}" | intent: ${intent ?? 'free-text'} | session: ${sessionId}`);

    const t0 = Date.now();
    let result: unknown;

    try {
      result = await this.executeByIntent(intent, prompt, memoryContext, primaryKey);
    } catch (err) {
      if (isInvalidKeyError(err)) {
        // If the per-user key was the culprit and we have a valid global key, auto-fallback
        if (storedKey && globalKey && storedKey !== globalKey) {
          this.logger.warn(`Per-user key for user ${userId} rejected — deleting and retrying with global key`);
          void this.userKeys.delete(userId).catch(() => {});
          try {
            result = await this.executeByIntent(intent, prompt, memoryContext, globalKey);
          } catch (retryErr) {
            if (isProviderRateLimitError(retryErr)) {
              const retryIn = extractRetryDelay(retryErr);
              const message = retryIn
                ? `Groq API quota reached. Try again in ${retryIn}.`
                : 'Groq API quota reached. Please try again later.';
              throw Object.assign(new HttpException({ error: message }, HttpStatus.TOO_MANY_REQUESTS), { code: 'LLM_RATE_LIMIT' });
            }
            throw Object.assign(
              new UnauthorizedException('Global Groq API key is also invalid. Contact the administrator.'),
              { code: 'INVALID_API_KEY' },
            );
          }
        } else {
          throw Object.assign(
            new UnauthorizedException('Invalid Groq API key. Please update it in settings.'),
            { code: 'INVALID_API_KEY' },
          );
        }
      } else if (isProviderRateLimitError(err)) {
        const retryIn = extractRetryDelay(err);
        const message = retryIn
          ? `Groq API quota reached. Try again in ${retryIn} or use a different API key.`
          : 'Groq API quota reached. Please try again later or use a different API key.';
        throw Object.assign(
          new HttpException({ error: message }, HttpStatus.TOO_MANY_REQUESTS),
          { code: 'LLM_RATE_LIMIT' },
        );
      } else {
        throw err;
      }
    }

    this.logger.log(`done in ${Date.now() - t0}ms`);

    const r = result as Record<string, unknown>;
    const resolvedType: 'dashboard' | 'report' | 'inquiry' =
      r && 'widgets' in r         ? 'dashboard'
      : r && 'reportSections' in r ? 'report'
      : 'inquiry';

    const messageResult: MessageResult =
      resolvedType === 'dashboard'
        ? { type: 'dashboard', dashboardSpec: result as MessageResult['dashboardSpec'], durationMs: Date.now() - t0 }
        : resolvedType === 'report'
          ? { type: 'report', reportSections: (r.reportSections as MessageResult['reportSections']) ?? [], durationMs: Date.now() - t0 }
          : { type: 'inquiry', summary: (r.summary as string) ?? '', durationMs: Date.now() - t0 };

    const messageId = randomUUID();
    const assistantMessage: ConversationMessage & { role: 'assistant'; result: MessageResult } = {
      messageId,
      role:      'assistant',
      result:    messageResult,
      createdAt: new Date().toISOString(),
    };

    saveConversationTurn({ threadId: sessionId, prompt, intent: displayIntent, assistant: assistantMessage })
      .catch(err => this.logger.error(`saveConversationTurn failed: ${err}`));

    if (resolvedType === 'dashboard') {
      return { intent: 'dashboard', chart: result, sessionId, messageId };
    }
    return { intent: resolvedType, ...(result as object), sessionId, messageId };
  }
}
