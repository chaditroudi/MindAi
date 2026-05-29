import { z } from 'zod';
import { log } from '../../observability/log.js';
import type { PermissionScope } from '../../types/index.js';
import { datasetSchema, taskPlanSchema } from '../schemas/intent.js';
import { buildAggregationFromPlan, executePipeline, validateRows } from '../tools/mongodb-tools.js';
import { dataStoreRepo } from '../../db/datastore.repository.js';

export async function runMongoDatasetQuery({
  plan,
  scope,
}: {
  plan: z.infer<typeof taskPlanSchema>;
  scope: PermissionScope;
}) {
  const empty: z.infer<typeof datasetSchema> = { rows: [], schema: {}, source: 'mongodb' };
  const dataStoreIdentifier = getDataStoreIdentifier(plan);

  if (!plan.needsData || !dataStoreIdentifier) {
    return { dataset: empty, executedPipeline: [] as Record<string, unknown>[] };
  }

  const dataStore = await dataStoreRepo.findDataStore(dataStoreIdentifier);
  if (!dataStore) throw new Error(`Data store '${dataStoreIdentifier}' not found.`);

  const { pipeline } = buildAggregationFromPlan({ plan, dataStore, scope });
  const executed = await executePipeline({ pipeline, collection: dataStore.collection, scope });
  const validated = validateRows({ rows: executed.rows, dataStore });

  log.info('mongo.dataset-ready', {
    tenantId: scope.tenantId,
    collection: dataStore.collection,
    rowCount: validated.rows.length,
  });

  return {
    dataset: {
      rows: validated.rows,
      schema: validated.schema,
      jsonSchema: validated.jsonSchema,
      source: 'mongodb' as const,
    },
    executedPipeline: pipeline,
  };
}

export async function runMongoRecordFetch({
  plan,
  scope,
}: {
  plan: z.infer<typeof taskPlanSchema>;
  scope: PermissionScope;
}) {
  const empty: z.infer<typeof datasetSchema> = { rows: [], schema: {}, source: 'mongodb' };
  const dataStoreIdentifier = getDataStoreIdentifier(plan);

  if (!plan.needsData || !dataStoreIdentifier) {
    return { dataset: empty, collection: undefined as string | undefined };
  }

  const dataStore = await dataStoreRepo.findDataStore(dataStoreIdentifier);
  if (!dataStore) throw new Error(`Data store '${dataStoreIdentifier}' not found.`);

  const rawPlan = {
    ...plan,
    query: { ...plan.query, aggregation: undefined, dimensions: [] },
  };

  const { pipeline } = buildAggregationFromPlan({ plan: rawPlan, dataStore, scope });
  const executed = await executePipeline({ pipeline, collection: dataStore.collection, scope });
  const validated = validateRows({ rows: executed.rows, dataStore });

  return {
    dataset: {
      rows: validated.rows,
      schema: validated.schema,
      jsonSchema: validated.jsonSchema,
      source: 'mongodb' as const,
    },
    collection: dataStore.collection,
  };
}

function getDataStoreIdentifier(plan: z.infer<typeof taskPlanSchema>) {
  return plan.query.dataStoreName ?? plan.query.dataStoreId;
}
