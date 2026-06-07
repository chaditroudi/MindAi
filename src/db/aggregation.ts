import { getMongo } from './mongo.client.js';
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
  const mongo = await getMongo();
  return await mongo.db
    .collection(collection)
    .aggregate(pipeline, { allowDiskUse: true, maxTimeMS: TIMEOUT_MS })
    .toArray() as Document[];
}
