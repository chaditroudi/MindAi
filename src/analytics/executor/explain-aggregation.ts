import type { Db } from 'mongodb';
import { getMongo } from '../../db/mongo.client.js';
import type { PermissionScope } from '../../types/index.js';
import { AGGREGATION_TIMEOUT_MS, enforceAggregationSafety } from './run-aggregation.js';

export async function explainAggregation({
  pipeline,
  collection,
  scope,
  db,
}: {
  pipeline: Record<string, unknown>[];
  collection: string;
  scope: PermissionScope;
  db?: Db;
}) {
  const safePipeline = enforceAggregationSafety(pipeline, scope);
  const mongo = db ? { db } : await getMongo();

  return mongo.db.collection(collection).aggregate(safePipeline, {
    allowDiskUse: true,
    maxTimeMS: AGGREGATION_TIMEOUT_MS,
  }).explain('executionStats');
}
