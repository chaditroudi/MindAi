import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { convertMessages } from '@mastra/core/agent';
import type { MastraDBMessage } from '@mastra/core/agent';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import type { CoreMessage } from 'ai';
import type { DashboardSpec } from '../types';
import { log } from '../common/logger/app.logger';

export type SessionIntent = 'dashboard' | 'report' | 'inquiry';

export interface ReportSection {
  heading: string;
  body: string;
}

export interface MessageResult {
  type: 'dashboard' | 'report' | 'inquiry';
  dashboardSpec?: DashboardSpec;
  reportSections?: ReportSection[];
  summary?: string;
  durationMs: number;
}

export interface ConversationMessage {
  messageId: string;
  role: 'user' | 'assistant';
  prompt?: string;
  intent?: SessionIntent;
  result?: MessageResult;
  createdAt?: string;
}

export interface SessionSummary {
  sessionId: string;
  title: string;
  intent: SessionIntent;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface SessionDetail {
  session: SessionSummary;
  messages: ConversationMessage[];
}

interface SaveConversationTurnInput {
  threadId: string;
  prompt: string;
  intent: SessionIntent;
  assistant: ConversationMessage & { role: 'assistant'; result: MessageResult };
}

mkdirSync('./data', { recursive: true });

const libsql = new LibSQLStore({
  id: 'mindai-memory',
  url: process.env['LIBSQL_URL'] ?? 'file:./data/memory.db',
});

export const memory = new Memory({
  storage: libsql,
  options: { lastMessages: 6 },
});

const RESOURCE_ID = 'mindai';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  }
  return new Date().toISOString();
}

function trimTitle(prompt: string): string {
  return prompt.trim().slice(0, 80) || 'New session';
}

function textFromMessage(message: MastraDBMessage): string {
  return message.content.parts
    .filter((part): part is Extract<typeof message.content.parts[number], { type: 'text'; text: string }> =>
      part.type === 'text' && typeof part.text === 'string')
    .map(part => part.text.trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

function assistantSummary(result: MessageResult): string {
  if (result.type === 'dashboard') {
    return `Dashboard: ${result.dashboardSpec?.title ?? 'chart'} — ${result.dashboardSpec?.summary ?? ''}`.trim();
  }
  if (result.type === 'report') {
    const headings = (result.reportSections ?? []).map(section => section.heading).join(', ');
    return `Report sections: ${headings}`.trim();
  }
  return result.summary?.trim() || 'Inquiry answered.';
}

function readMessageResult(value: unknown): MessageResult | undefined {
  if (!isRecord(value)) return undefined;

  const type = value.type;
  const durationMs = typeof value.durationMs === 'number' && Number.isFinite(value.durationMs) ? value.durationMs : 0;

  if (type === 'dashboard') {
    return {
      type,
      dashboardSpec: isRecord(value.dashboardSpec) ? value.dashboardSpec as unknown as DashboardSpec : undefined,
      durationMs,
    };
  }

  if (type === 'report') {
    const reportSections = Array.isArray(value.reportSections)
      ? value.reportSections.filter(isRecord).map(section => ({
          heading: typeof section.heading === 'string' ? section.heading : 'Section',
          body:    typeof section.body === 'string' ? section.body : '',
        }))
      : [];
    return { type, reportSections, durationMs };
  }

  if (type === 'inquiry') {
    return {
      type,
      summary: typeof value.summary === 'string' ? value.summary : '',
      durationMs,
    };
  }

  return undefined;
}

function readConversationMessage(message: MastraDBMessage): ConversationMessage | null {
  const uiMessage = isRecord(message.content.metadata) ? message.content.metadata.uiMessage : undefined;

  if (isRecord(uiMessage)) {
    const role = uiMessage.role;
    const messageId = typeof uiMessage.messageId === 'string' ? uiMessage.messageId : message.id;
    const createdAt = toIsoString(uiMessage.createdAt ?? message.createdAt);

    if (role === 'user') {
      return {
        messageId,
        role: 'user',
        prompt: typeof uiMessage.prompt === 'string' ? uiMessage.prompt : textFromMessage(message),
        intent: uiMessage.intent === 'dashboard' || uiMessage.intent === 'report' || uiMessage.intent === 'inquiry'
          ? uiMessage.intent
          : undefined,
        createdAt,
      };
    }

    if (role === 'assistant') {
      const result = readMessageResult(uiMessage.result);
      if (!result) return null;
      return { messageId, role: 'assistant', result, createdAt };
    }
  }

  if (message.role === 'user') {
    return {
      messageId: message.id,
      role: 'user',
      prompt: textFromMessage(message),
      createdAt: toIsoString(message.createdAt),
    };
  }

  if (message.role === 'assistant') {
    return {
      messageId: message.id,
      role: 'assistant',
      result: { type: 'inquiry', summary: textFromMessage(message), durationMs: 0 },
      createdAt: toIsoString(message.createdAt),
    };
  }

  return null;
}

function buildSessionSummary(
  thread: { id: string; title?: string; createdAt?: Date | string; updatedAt?: Date | string; metadata?: Record<string, unknown> },
  messages: ConversationMessage[],
): SessionSummary {
  const firstUser = messages.find(message => message.role === 'user');
  const metadataIntent = isRecord(thread.metadata) ? thread.metadata.intent : undefined;
  const intent = metadataIntent === 'dashboard' || metadataIntent === 'report' || metadataIntent === 'inquiry'
    ? metadataIntent
    : firstUser?.intent ?? 'inquiry';

  return {
    sessionId:    thread.id,
    title:        thread.title?.trim() || trimTitle(firstUser?.prompt ?? ''),
    intent,
    createdAt:    toIsoString(thread.createdAt),
    updatedAt:    toIsoString(thread.updatedAt),
    messageCount: messages.length,
  };
}

export async function sessionExists(threadId: string): Promise<boolean> {
  try {
    const thread = await memory.getThreadById({ threadId, resourceId: RESOURCE_ID });
    return Boolean(thread);
  } catch (err) {
    log('memory', `sessionExists failed (non-fatal): ${String(err)}`);
    return false;
  }
}

export async function ensureThread(threadId: string, title: string, intent?: SessionIntent): Promise<void> {
  try {
    const existing = await memory.getThreadById({ threadId, resourceId: RESOURCE_ID });

    if (existing) {
      const nextTitle = existing.title?.trim() || trimTitle(title);
      const nextMetadata = {
        ...(isRecord(existing.metadata) ? existing.metadata : {}),
        ...(intent ? { intent } : {}),
      };
      if (nextTitle !== existing.title || JSON.stringify(nextMetadata) !== JSON.stringify(existing.metadata ?? {})) {
        await memory.updateThread({ id: threadId, title: nextTitle, metadata: nextMetadata });
      }
      return;
    }

    await memory.saveThread({
      thread: {
        id: threadId,
        resourceId: RESOURCE_ID,
        title: trimTitle(title),
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: intent ? { intent } : {},
      },
    });
    log('memory', `thread created: ${threadId}`);
  } catch (err) {
    log('memory', `ensureThread failed (non-fatal): ${String(err)}`);
  }
}

export async function getMemoryContext(threadId: string): Promise<CoreMessage[]> {
  try {
    const { messages } = await memory.getContext({ threadId, resourceId: RESOURCE_ID });
    if (!messages.length) return [];
    return convertMessages(messages).to('AIV4.Core') as CoreMessage[];
  } catch (err) {
    log('memory', `getMemoryContext failed (non-fatal): ${String(err)}`);
    return [];
  }
}

export async function saveConversationTurn({
  threadId,
  prompt,
  intent,
  assistant,
}: SaveConversationTurnInput): Promise<void> {
  try {
    const now = new Date();
    const userMessage: ConversationMessage = {
      messageId: randomUUID(),
      role: 'user',
      prompt,
      intent,
      createdAt: now.toISOString(),
    };

    const assistantMessage: ConversationMessage = {
      ...assistant,
      createdAt: assistant.createdAt ?? new Date(now.getTime() + 1).toISOString(),
    };

    const messages: MastraDBMessage[] = [
      {
        id: randomUUID(),
        role: 'user',
        createdAt: now,
        threadId,
        resourceId: RESOURCE_ID,
        content: {
          format: 2,
          parts: [{ type: 'text', text: prompt }],
          metadata: { uiMessage: userMessage },
        },
      },
      {
        id: randomUUID(),
        role: 'assistant',
        createdAt: new Date(now.getTime() + 1),
        threadId,
        resourceId: RESOURCE_ID,
        content: {
          format: 2,
          parts: [{ type: 'text', text: assistantSummary(assistant.result) }],
          metadata: { uiMessage: assistantMessage },
        },
      },
    ];

    await memory.saveMessages({ messages });
    log('memory', `saved turn to thread: ${threadId}`);
  } catch (err) {
    log('memory', `saveConversationTurn failed (non-fatal): ${String(err)}`);
  }
}

export async function listSessions(): Promise<SessionSummary[]> {
  const { threads } = await memory.listThreads({
    filter: { resourceId: RESOURCE_ID },
    perPage: false,
    orderBy: { field: 'updatedAt', direction: 'DESC' },
  });

  const summaries = await Promise.all(threads.map(async thread => {
    const detail = await getSessionDetail(thread.id);
    return detail?.session ?? buildSessionSummary(thread, []);
  }));

  return summaries;
}

export async function getSessionDetail(threadId: string): Promise<SessionDetail | null> {
  const thread = await memory.getThreadById({ threadId, resourceId: RESOURCE_ID });
  if (!thread) return null;

  const { messages } = await memory.recall({
    threadId,
    resourceId: RESOURCE_ID,
    perPage: false,
    orderBy: { field: 'createdAt', direction: 'ASC' },
  });

  const conversation = messages
    .map(readConversationMessage)
    .filter((message): message is ConversationMessage => message !== null);

  return {
    session: buildSessionSummary(thread, conversation),
    messages: conversation,
  };
}

export async function deleteSession(threadId: string): Promise<boolean> {
  const exists = await sessionExists(threadId);
  if (!exists) return false;
  await memory.deleteThread(threadId);
  return true;
}
