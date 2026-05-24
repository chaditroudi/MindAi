import type { Db } from 'mongodb';
import { getMongo } from '../../db/mongo.client.js';
import type { PermissionScope } from '../../types/index.js';

export const MAX_PIPELINE_STAGES = 25;
export const AGGREGATION_TIMEOUT_MS = 30_000;

const blockedStages = new Set(['$function', '$merge', '$out', '$where']);

export async function runAggregation({
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
  const rows = (await mongo.db
    .collection(collection)
    .aggregate(safePipeline, {
      allowDiskUse: true,
      maxTimeMS: AGGREGATION_TIMEOUT_MS,
    })
    .toArray()) as Record<string, unknown>[];

  return { rows, rowCount: rows.length };
}

export function enforceAggregationSafety(
  pipeline: Record<string, unknown>[],
  scope: PermissionScope,
): Record<string, unknown>[] {
  if (pipeline.length > MAX_PIPELINE_STAGES) {
    throw new Error(`Aggregation pipeline exceeds ${MAX_PIPELINE_STAGES} stages.`);
  }

  for (const stage of pipeline) {
    for (const key of Object.keys(stage)) {
      if (blockedStages.has(key)) throw new Error(`Blocked aggregation stage '${key}'.`);
    }
  }

  const safePipeline = [...pipeline];
  const firstMatch = safePipeline[0]?.$match as Record<string, unknown> | undefined;
  if (!firstMatch || firstMatch.tenantId !== scope.tenantId) {
    safePipeline.unshift({ $match: { tenantId: scope.tenantId } });
  }

  return safePipeline;
}
