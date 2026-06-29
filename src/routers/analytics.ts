import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { featureRegistry } from '../features/registry.js';
import { analyticsAgent } from '../session/agent.js';
import { loadSession, saveSession } from '../middleware/session.middleware.js';
import type { MessageResult, ConversationMessage } from '../session/memory.js';
import { getSources } from '../db/sources-cache.js';
import { getUserKey } from '../db/user-keys.repository.js';
import { log, logSep } from '../utils/logger.js';

const analyticsInputSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required').max(1000, 'Prompt must be 1000 characters or fewer'),
});

export const analyticsRouter = Router();

analyticsRouter.get('/provider', (_req, res) => {
  // Provider is determined per-user from their saved API key — no server-level default.
  res.json({ provider: '', hasGlobalKey: false });
});

analyticsRouter.post('/analytics', loadSession, saveSession, async (req, res) => {
  try {
    const userId = (req.headers['x-user-id'] as string | undefined)?.trim();
    if (!userId) {
      res.status(401).json({ error: 'User ID missing. Please reload the app.' });
      return;
    }
    const userApiKey = await getUserKey(userId);
    if (!userApiKey) {
      res.status(401).json({ error: 'No API key found. Please add your AI provider key in settings.' });
      return;
    }

    if (!getSources().length) {
      res.status(400).json({ error: 'No data sources configured.', action: 'Run npm run seed first.' });
      return;
    }

    const { prompt, intent } = req.body as { prompt: string; intent?: string };
    const ctx = analyticsInputSchema.parse({ prompt });

    const knownIntent = intent === 'dashboard' ? 'dashboard'
      : intent === 'report'  ? 'report'
      : intent === 'inquiry' ? 'inquiry'
      : null;

    logSep('POST /api/analytics');
    log('router', `prompt: "${ctx.prompt}" | intent: ${knownIntent ?? 'free-text (agent)'} | session: ${req.sessionId}`);

    const reqStart = Date.now();
    let result: unknown;

    const handler = knownIntent ? featureRegistry[knownIntent] : null;
    if (handler) {
      result = await handler(ctx.prompt, req.memoryContext, userApiKey);
    } else {
      log('router', 'no intent — routing through analyticsAgent');
      const agentResponse = await analyticsAgent.generateLegacy(
        [{ role: 'user', content: ctx.prompt }],
        { maxSteps: 2 },
      );
      const toolResult = agentResponse.toolResults?.[0];
      result = toolResult?.result ?? { summary: agentResponse.text ?? 'No result.' };
    }

    const durationMs = Date.now() - reqStart;
    log('router', `done in ${durationMs}ms`);

    const r = result as Record<string, unknown>;
    const resolvedType: 'dashboard' | 'report' | 'inquiry' =
      r && 'widgets' in r         ? 'dashboard'
      : r && 'reportSections' in r ? 'report'
      : 'inquiry';

    const messageResult: MessageResult =
      resolvedType === 'dashboard'
        ? { type: 'dashboard', dashboardSpec: result as MessageResult['dashboardSpec'], durationMs }
        : resolvedType === 'report'
          ? { type: 'report', reportSections: (r.reportSections as MessageResult['reportSections']) ?? [], durationMs }
          : { type: 'inquiry', summary: (r.summary as string) ?? '', durationMs };

    const assistantMessage: ConversationMessage & { role: 'assistant'; result: MessageResult } = {
      messageId: randomUUID(),
      role:      'assistant',
      result:    messageResult,
      createdAt: new Date().toISOString(),
    };

    res.locals.assistantMessage = assistantMessage;

    if (resolvedType === 'dashboard') {
      res.json({ intent: 'dashboard', chart: result, sessionId: req.sessionId, messageId: assistantMessage.messageId });
      return;
    }
    res.json({ intent: resolvedType, ...(result as object), sessionId: req.sessionId, messageId: assistantMessage.messageId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log('router', `ERROR: ${msg}`);
    if (isInvalidKeyError(err)) {
      res.status(422).json({ error: 'Invalid API key. Please update it in settings.', code: 'INVALID_API_KEY' });
      return;
    }
    res.status(500).json({ error: msg });
  }
});

function isInvalidKeyError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  const statusCode = (err as { statusCode?: number; status?: number }).statusCode
    ?? (err as { status?: number }).status;
  if (statusCode === 401 || statusCode === 403) return true;
  return msg.includes('401') ||
         msg.includes('403') ||
         msg.includes('invalid_api_key') ||
         msg.includes('invalid api key') ||
         msg.includes('incorrect api key') ||
         msg.includes('authentication') ||
         msg.includes('api key');
}
