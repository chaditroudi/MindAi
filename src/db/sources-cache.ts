import { getMongo } from './mongo.client.js';
import type { DataSource } from '../types/index.js';

let cache: DataSource[] = [];

export async function initSources(): Promise<void> {
  const { db } = await getMongo();
  const docs = await db
    .collection('sources')
    .find({}, { projection: { _id: 0 } })
    .toArray();
  cache = docs as unknown as DataSource[];
  console.log(`  Sources: ${cache.length} dataset(s) loaded`);
}

export function getSources(): DataSource[] {
  return cache;
}

export async function reloadSources(): Promise<void> {
  await initSources();
}
