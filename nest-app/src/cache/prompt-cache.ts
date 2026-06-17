// Standalone cache helpers — used only by the Mastra agent fallback path (features/pipeline.ts).
// The primary pipeline path uses CacheService (DI) instead.
import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { log } from '../common/logger/app.logger';

interface PromptCacheDoc {
  key:       string;
  prompt:    string;
  intent:    string;
  result:    unknown;
  hitCount:  number;
  lastHitAt: Date;
  createdAt: Date;
}

function cacheKey(intent: string, prompt: string): string {
  return createHash('sha256')
    .update(`${intent}:${prompt.trim().toLowerCase().replace(/\s+/g, ' ')}`)
    .digest('hex')
    .slice(0, 24);
}

function col() {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB not connected');
  return db.collection<PromptCacheDoc>('prompt_cache');
}

export async function getCached<T>(intent: string, prompt: string): Promise<T | null> {
  const key = cacheKey(intent, prompt);
  const entry = await col().findOneAndUpdate(
    { key },
    { $inc: { hitCount: 1 }, $set: { lastHitAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (entry) log('cache', `HIT  | key: ${key} | intent: ${intent}`);
  return (entry?.result as T) ?? null;
}

export async function setCached<T>(intent: string, prompt: string, result: T): Promise<void> {
  const key = cacheKey(intent, prompt);
  await col().replaceOne(
    { key },
    { key, prompt: prompt.trim(), intent, result, createdAt: new Date(), hitCount: 0, lastHitAt: new Date() },
    { upsert: true },
  );
  log('cache', `SAVE | key: ${key} | intent: ${intent}`);
}

export async function deleteCached(key: string): Promise<boolean> {
  const r = await col().deleteOne({ key });
  return r.deletedCount > 0;
}

export async function listCacheEntries(): Promise<PromptCacheDoc[]> {
  return col().find({}, { projection: { result: 0 } }).sort({ lastHitAt: -1 }).limit(100).toArray();
}
