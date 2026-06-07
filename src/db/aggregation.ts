import { getMongo } from './mongo.client.js';
import { log } from '../utils/logger.js';
import type { Document } from 'mongodb';

export type PipelineStage = Document;

const TIMEOUT_MS = 30_000;

export async function executePipeline({
  pipeline,
  collection,
}: {
  pipeline:   PipelineStage[];
  collection: string;
}) {
  log('aggregation', `running on: "${collection}" | stages: ${pipeline.length}`, pipeline);
  const mongo = await getMongo();
  const rows  = await mongo.db
    .collection(collection)
    .aggregate(pipeline, { allowDiskUse: true, maxTimeMS: TIMEOUT_MS })
    .toArray() as Document[];
  log('aggregation', `returned ${rows.length} row(s)${rows.length ? ' — sample: ' + JSON.stringify(rows[0]) : ''}`);
  return rows;
}
