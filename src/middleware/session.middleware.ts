import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { CoreMessage } from 'ai';
import {
  ensureThread,
  getMemoryContext,
  saveConversationTurn,
  sessionExists,
  type ConversationMessage,
  type MessageResult,
  type SessionIntent,
} from '../session/memory.js';
import { log } from '../utils/logger.js';

declare global {
  namespace Express {
    interface Request {
      sessionId:      string;
      memoryContext:  CoreMessage[];
      displayIntent:  SessionIntent;
    }
    interface Locals {
      assistantMessage?: ConversationMessage & { role: 'assistant'; result: MessageResult };
    }
  }
}

export async function loadSession(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const { prompt, intent, sessionId: incoming } = req.body as {
    prompt:     string;
    intent?:    string;
    sessionId?: string | null;
  };

  const displayIntent: SessionIntent =
    intent === 'dashboard' ? 'dashboard'
    : intent === 'report'  ? 'report'
    : 'inquiry';

  const requested = typeof incoming === 'string' && incoming.trim() ? incoming.trim() : null;
  const sessionId = requested && await sessionExists(requested) ? requested : randomUUID();

  await ensureThread(sessionId, prompt, displayIntent);
  const memoryContext = await getMemoryContext(sessionId);

  req.sessionId     = sessionId;
  req.memoryContext = memoryContext;
  req.displayIntent = displayIntent;

  next();
}

export function saveSession(req: Request, res: Response, next: NextFunction): void {
  res.on('finish', () => {
    const msg = res.locals.assistantMessage;
    if (!msg) return;
    saveConversationTurn({
      threadId:  req.sessionId,
      prompt:    (req.body as { prompt: string }).prompt,
      intent:    req.displayIntent,
      assistant: msg,
    }).catch(err => log('session', `saveConversationTurn failed: ${err}`));
  });
  next();
}
