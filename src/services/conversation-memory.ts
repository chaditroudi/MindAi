import { getMongo } from '../db/mongo.client.js';
import type { ConversationRef, IntentKind, PermissionScope } from '../types/index.js';

const COLLECTION_NAME = 'conversation_memory';
const MAX_STORED_CONTENT_LENGTH = 4000;

interface ConversationTurnDocument {
  threadId: string;
  resourceId: string;
  tenantId: string;
  userId: string;
  role: 'user' | 'assistant';
  endpointIntent: IntentKind;
  content: string;
  createdAt: Date;
}

export function resolveConversationRef({
  scope,
  threadId,
  resourceId,
}: {
  scope: PermissionScope;
  threadId?: string;
  resourceId?: string;
}): ConversationRef {
  const fallbackResourceId = `tenant:${scope.tenantId}:user:${scope.userId}`;
  return {
    resourceId: sanitizeMemoryId(resourceId) ?? fallbackResourceId,
    threadId: sanitizeMemoryId(threadId) ?? `${fallbackResourceId}:default`,
  };
}

export async function buildConversationMemoryPrompt(ref: ConversationRef): Promise<string | undefined> {
  const turns = await getRecentTurns(ref, 8);
  if (turns.length === 0) return undefined;

  const renderedTurns = turns
    .map((turn) => `[${turn.endpointIntent}:${turn.role}] ${stripMemoryEnvelope(turn.content)}`)
    .join('\n');

  return [
    'Recent conversation memory, oldest to newest:',
    renderedTurns,
    '',
    'Use this memory only to resolve follow-up references and user preferences. Current MongoDB data and the current request still take priority.',
  ].join('\n');
}

export async function saveConversationExchange({
  ref,
  scope,
  intent,
  userPrompt,
  assistantContent,
}: {
  ref: ConversationRef;
  scope: PermissionScope;
  intent: IntentKind;
  userPrompt: string;
  assistantContent: string;
}) {
  const { db } = await getMongo();
  const now = Date.now();
  const base = {
    threadId: ref.threadId,
    resourceId: ref.resourceId,
    tenantId: scope.tenantId,
    userId: scope.userId,
    endpointIntent: intent,
  };

  await db.collection<ConversationTurnDocument>(COLLECTION_NAME).insertMany([
    {
      ...base,
      role: 'user',
      content: truncateMemoryContent(userPrompt),
      createdAt: new Date(now),
    },
    {
      ...base,
      role: 'assistant',
      content: truncateMemoryContent(assistantContent),
      createdAt: new Date(now + 1),
    },
  ]);
}

async function getRecentTurns(ref: ConversationRef, limit: number): Promise<ConversationTurnDocument[]> {
  const { db } = await getMongo();
  const newest = await db
    .collection<ConversationTurnDocument>(COLLECTION_NAME)
    .find({ threadId: ref.threadId, resourceId: ref.resourceId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  return newest.reverse();
}

function sanitizeMemoryId(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/[^\w:.-]/g, '_').slice(0, 200);
}

function truncateMemoryContent(content: string) {
  const normalized = content.replace(/\s+/g, ' ').trim();
  return normalized.length > MAX_STORED_CONTENT_LENGTH
    ? `${normalized.slice(0, MAX_STORED_CONTENT_LENGTH)}...`
    : normalized;
}

function stripMemoryEnvelope(content: string) {
  return content
    .replace(/^Recent conversation memory, oldest to newest:.*?Current [a-z_]+ request:/i, '')
    .replace(/Use this memory only to resolve follow-up references and user preferences\..*?priority\./i, '')
    .trim();
}
