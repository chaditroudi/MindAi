// prompt cache — sha256 key, 7-day TTL. multi-turn context turns skip caching.
import { createHash } from 'node:crypto';
import type { WithId } from 'mongodb';
import { getMongo } from './mongo.client.js';
import { log } from '../utils/logger.js';

interface PromptCacheDoc {
  _id:       string;
  prompt:    string;
  intent:    string;
  result:    unknown;
  createdAt: Date;
  hitCount:  number;
  lastHitAt: Date;
}


export async function initCache(): Promise<void> {
  const { db } = await getMongo();
  const col = db.collection('prompt_cache');
  await col.createIndex({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600, name: 'ttl_7d' });
  await col.createIndex({ intent: 1 }, { name: 'intent' });
  log('cache', 'prompt_cache indexes ready (TTL 7d)');
}


function cacheKey(intent: string, prompt: string): string {
  return createHash('sha256')
    .update(`${intent}:${prompt.trim().toLowerCase().replace(/\s+/g, ' ')}`)
    .digest('hex')
    .slice(0, 24);
}

function col(db: Awaited<ReturnType<typeof getMongo>>['db']) {
  return db.collection<PromptCacheDoc>('prompt_cache');
}


export async function getCached<T>(intent: string, prompt: string): Promise<T | null> {
  const { db } = await getMongo();
  const key = cacheKey(intent, prompt);
  const entry = await col(db).findOneAndUpdate(
    { _id: key },
    { $inc: { hitCount: 1 }, $set: { lastHitAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (entry) {
    log('cache', `HIT  | key: ${key} | hits: ${entry.hitCount} | intent: ${intent}`);
  }
  return (entry?.result as T) ?? null;
}

export async function setCached<T>(intent: string, prompt: string, result: T): Promise<void> {
  const { db } = await getMongo();
  const key = cacheKey(intent, prompt);
  await col(db).replaceOne(
    { _id: key },
    { prompt: prompt.trim(), intent, result, createdAt: new Date(), hitCount: 0, lastHitAt: new Date() },
    { upsert: true },
  );
  log('cache', `SAVE | key: ${key} | intent: ${intent}`);
}

export async function deleteCached(key: string): Promise<boolean> {
  const { db } = await getMongo();
  const r = await col(db).deleteOne({ _id: key });
  return r.deletedCount > 0;
}

export async function listCacheEntries(): Promise<WithId<PromptCacheDoc>[]> {
  const { db } = await getMongo();
  return col(db)
    .find({}, { projection: { result: 0 } })
    .sort({ lastHitAt: -1 })
    .limit(100)
    .toArray();
}
