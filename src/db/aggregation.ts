import { getMongo } from './mongo.client.js';
import { log, logTrace } from '../utils/logger.js';
import { config } from '../config.js';
import type { Document } from 'mongodb';

export type PipelineStage = Document;

const MAX_ROWS = 500;

function ensureLimit(pipeline: PipelineStage[]): PipelineStage[] {
  const hasLimit = pipeline.some(stage => '$limit' in stage);
  if (hasLimit) return pipeline;
  log('db', `no $limit stage — injecting { $limit: ${MAX_ROWS} } as safety guard`);
  return [...pipeline, { $limit: MAX_ROWS }];
}

export async function executePipeline({
  pipeline,
  collection,
}: {
  pipeline:   PipelineStage[];
  collection: string;
}): Promise<Document[]> {
  const safe = ensureLimit(pipeline);
  logTrace('db', `executing pipeline on "${collection}"`, safe);
  const { db } = await getMongo();
  const t0 = Date.now();
  const rows = await db
    .collection(collection)
    .aggregate(safe, { allowDiskUse: true, maxTimeMS: config.mongodb.pipelineTimeoutMs })
    .toArray() as Document[];
  log('db', `pipeline done | collection: ${collection} | rows: ${rows.length} | ${Date.now() - t0}ms`);
  logTrace('db', `pipeline result rows`, rows.slice(0, 10));
  return rows;
}
