import type { Mastra } from '@mastra/core/mastra';
import { z } from 'zod';
import { dataStoreRepo } from '../../db/datastore.repository.js';
import { log, logged } from '../../observability/log.js';
import type { PermissionScope } from '../../types/index.js';
import { datasetSchema, taskPlanSchema } from '../schemas/intent.js';
import { buildAggregationFromPlan, executePipeline, validateRows } from '../tools/mongodb-tools.js';

export async function runMongoDatasetQuery({
  plan,
  scope,
  mastra,
}: {
  plan: z.infer<typeof taskPlanSchema>;
  scope: PermissionScope;
  mastra: Mastra;
}) {
  const empty: z.infer<typeof datasetSchema> = { rows: [], schema: {}, source: 'mongodb' };

  if (!plan.needsData || !plan.query.dataStoreName) {
    return {
      dataset: empty,
      executedPipeline: [] as Record<string, unknown>[],
      agentNotes: [] as string[],
    };
  }

  const dataStore = await dataStoreRepo.findDataStore(plan.query.dataStoreName);
  if (!dataStore) {
    throw new Error(`Data store '${plan.query.dataStoreName}' not found.`);
  }

  const { pipeline } = await logged(
    'mongo.build-aggregation',
    { agent: 'mongodbAgent', tenantId: scope.tenantId, collection: dataStore.collection, source: 'deterministic' },
    async () => buildAggregationFromPlan({ plan, dataStore, scope }),
  );

  const executed = await logged(
    'mongo.execute-pipeline',
    { agent: 'mongodbAgent', tenantId: scope.tenantId, collection: dataStore.collection },
    async () => executePipeline({ pipeline, collection: dataStore.collection, scope }),
  );
  const validated = validateRows({ rows: executed.rows, dataStore });

  log.info('mongo.dataset-ready', {
    agent: 'mongodbAgent',
    tenantId: scope.tenantId,
    collection: dataStore.collection,
    rowCount: validated.rows.length,
  });

  return {
    dataset: {
      rows: validated.rows,
      schema: validated.schema,
      source: 'mongodb' as const,
    },
    executedPipeline: pipeline,
    agentNotes: [] as string[],
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

  if (!plan.needsData || !plan.query.dataStoreName) {
    return {
      dataset: empty,
      collection: undefined as string | undefined,
    };
  }

  const dataStore = await dataStoreRepo.findDataStore(plan.query.dataStoreName);
  if (!dataStore) {
    throw new Error(`Data store '${plan.query.dataStoreName}' not found.`);
  }

  const rawPlan = {
    ...plan,
    query: {
      ...plan.query,
      aggregation: undefined,
      dimensions: [],
    },
  };

  const { pipeline } = buildAggregationFromPlan({ plan: rawPlan, dataStore, scope });
  const executed = await executePipeline({ pipeline, collection: dataStore.collection, scope });
  const validated = validateRows({ rows: executed.rows, dataStore });

  return {
    dataset: {
      rows: validated.rows,
      schema: validated.schema,
      source: 'mongodb' as const,
    },
    collection: dataStore.collection,
  };
}
