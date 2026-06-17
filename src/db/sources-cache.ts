import { getMongo } from './mongo.client.js';
import { log } from '../utils/logger.js';
import type { DataSource } from '../types/index.js';

let cache: DataSource[] = [];

export async function initSources(): Promise<void> {
  const { db } = await getMongo();
  const docs = await db
    .collection('sources')
    .find({}, { projection: { _id: 0 } })
    .toArray();
  cache = docs as unknown as DataSource[];
  if (cache.length) {
    log('sources', `${cache.length} dataset(s) loaded: ${cache.map(s => s.name).join(', ')}`);
  } else {
    log('sources', 'No sources found — register a dataset via POST /api/sources');
  }
}

export function getSources(): DataSource[] {
  return cache;
}

export async function reloadSources(): Promise<void> {
  await initSources();
}
