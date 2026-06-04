import type { ConversationRef } from '../types/index.js';

export interface SessionDataset {
  rows: Record<string, string | number | boolean | null>[];
  schema: Record<string, string>;
  source: 'mongodb' | 'search' | 'merged';
  jsonSchema?: Record<string, unknown>;
  citations?: { title: string; url?: string; snippet?: string }[];
}

const datasetContextCache = new Map<string, SessionDataset>();

export function loadDatasetContext(ref: ConversationRef): SessionDataset | undefined {
  return datasetContextCache.get(cacheKey(ref));
}

export function saveDatasetContext(ref: ConversationRef, dataset: SessionDataset | undefined) {
  if (!dataset) return;
  if (!Array.isArray(dataset.rows) || dataset.rows.length === 0) return;
  datasetContextCache.set(cacheKey(ref), dataset);
}

export function resolveDatasetContext(ref: ConversationRef, dataset?: SessionDataset) {
  if (dataset) {
    saveDatasetContext(ref, dataset);
    return dataset;
  }
  return loadDatasetContext(ref);
}

function cacheKey(ref: ConversationRef) {
  return `${ref.resourceId}::${ref.threadId}`;
}
