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

  async run(req: AnalyticsRequest): Promise<AnalyticsResponse> {
    const { userId, intent, sessionId: incoming } = req;
    const prompt = promptSchema.parse(req.prompt);

    if (!getSources().length) {
      throw new BadRequestException('No data sources configured. Run the seed script first.');
    }

    // Per-user key takes priority; fall back to the server-level GROQ_API_KEY for testing/shared deployments
    const userApiKey =
      (await this.userKeys.get(userId))?.trim() ||
      this.cfg.get<string>('llm.groqApiKey')?.trim() ||
      null;

    if (!userApiKey) {
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
      if (intent === 'dashboard') {
        result = await this.pipeline.executeDashboard(prompt, memoryContext, userApiKey);
      } else if (intent === 'report') {
        result = await this.pipeline.executeReport(prompt, memoryContext, userApiKey);
      } else if (intent === 'inquiry') {
        result = await this.pipeline.executeInquiry(prompt, memoryContext, userApiKey);
      } else {
        this.logger.log('no intent — routing through analyticsAgent');
        const agentResponse = await analyticsAgent.generateLegacy(
          [{ role: 'user', content: prompt }],
          { maxSteps: 2 },
        );
        const toolResult = agentResponse.toolResults?.[0];
        result = toolResult?.result ?? { summary: agentResponse.text ?? 'No result.' };
      }
    } catch (err) {
      if (isInvalidKeyError(err)) {
        throw Object.assign(
          new UnauthorizedException('Invalid Groq API key. Please update it in settings.'),
          { code: 'INVALID_API_KEY' },
        );
      }
      if (isProviderRateLimitError(err)) {
        const retryIn = extractRetryDelay(err);
        const message = retryIn
          ? `Groq API quota reached. Try again in ${retryIn} or use a different API key.`
          : 'Groq API quota reached. Please try again later or use a different API key.';
        throw Object.assign(
          new HttpException({ error: message }, HttpStatus.TOO_MANY_REQUESTS),
          { code: 'LLM_RATE_LIMIT' },
        );
      }
      throw err;
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
