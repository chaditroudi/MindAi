import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { log } from '../../observability/log.js';
import { permissionScopeSchema } from '../schemas/datastore.js';
import { taskPlanSchema, datasetSchema } from '../schemas/intent.js';
import { chartResultSchema } from '../schemas/chart.js';
import { executePipeline, executePipelineInMemory, validateRows } from '../../db/aggregation.js';
import { dataStoreSchema } from '../schemas/datastore.js';
import { resolveDataStores, findInDataStores } from '../../db/datastore.repository.js';
import { validatePipelineForDataStore } from '../../db/pipeline-validator.js';
import { runChartRuntime } from '../agents/chart.js';
import { runSupervisorPlan } from '../agents/supervisor.js';

const themeSchema = z.enum(['light', 'dark', 'brand']).default('light');

const planStep = createStep({
  id: 'plan',
  inputSchema: z.object({
    prompt: z.string(),
    planningPrompt: z.string().optional(),
    intent: z.enum(['general_question', 'report', 'dashboard']).optional(),
    scope: permissionScopeSchema,
    topic: z.string().optional(),
    dataStoreName: z.string().optional(),
    theme: themeSchema,
    datastores: z.array(dataStoreSchema).optional(),
    dataset: datasetSchema.optional(),
  }),
  outputSchema: z.object({
    plan: taskPlanSchema,
    scope: permissionScopeSchema,
    prompt: z.string(),
    theme: themeSchema,
    datastores: z.array(dataStoreSchema).optional(),
    sourceDataset: datasetSchema.optional(),
  }),
  execute: async ({ inputData, mastra }) => ({
    plan: await runSupervisorPlan({
      mastra: mastra!,
      prompt: inputData.prompt,
      planningPrompt: inputData.planningPrompt,
      intent: inputData.intent ?? 'dashboard',
      scope: inputData.scope,
      topic: inputData.topic,
      dataStoreName: inputData.dataStoreName,
      datastores: inputData.datastores,
    }),
    scope: inputData.scope,
    prompt: inputData.prompt,
    theme: inputData.theme,
    datastores: inputData.datastores,
    sourceDataset: inputData.dataset,
  }),
});

const queryStep = createStep({
  id: 'query',
  inputSchema: planStep.outputSchema,
  outputSchema: z.object({
    plan: taskPlanSchema,
    scope: permissionScopeSchema,
    prompt: z.string(),
    theme: themeSchema,
    dataset: datasetSchema,
    executedPipeline: z.array(z.record(z.unknown())),
  }),
  execute: async ({ inputData }) => {
    const { plan, scope } = inputData;
    const emptyDataset = {
      rows: [],
      schema: {},
      source: inputData.sourceDataset?.source ?? 'merged' as const,
    };

    if (!plan.needsData) {
      return { ...inputData, dataset: emptyDataset, executedPipeline: [] };
    }

    if (!plan.pipeline?.length) {
      throw new Error('Supervisor plan requires data but did not return a pipeline.');
    }

    const allStores = await resolveDataStores(scope, inputData.datastores);
    const dataStoreId = plan.query.dataStoreName ?? plan.query.dataStoreId;
    const dataStore = dataStoreId ? findInDataStores(dataStoreId, allStores) : undefined;
    if (!dataStore) {
      throw new Error(`Supervisor selected unknown data store "${dataStoreId ?? 'undefined'}".`);
    }

    const validatedPipeline = validatePipelineForDataStore({
      pipeline: plan.pipeline,
      dataStore,
      availableDataStores: allStores,
    });

    const executed = inputData.sourceDataset
      ? executePipelineInMemory({
          pipeline: validatedPipeline,
          rows: inputData.sourceDataset.rows,
          scope,
        })
      : await executePipeline({
          pipeline: validatedPipeline,
          collection: dataStore.collection,
          scope,
        });

    const { rows, schema } = validateRows(executed.rows);
    const source = inputData.sourceDataset?.source ?? 'mongodb';

    log.info('workflow.dashboard.query', { tenantId: scope.tenantId, collection: dataStore.collection, rowCount: rows.length, source });

    return {
      ...inputData,
      dataset: { rows, schema, source },
      executedPipeline: validatedPipeline,
    };
  },
});

const chartStep = createStep({
  id: 'chart',
  inputSchema: queryStep.outputSchema,
  outputSchema: z.object({
    chart: chartResultSchema,
    dataset: datasetSchema,
    plan: taskPlanSchema,
    executedPipeline: z.array(z.record(z.unknown())),
  }),
  execute: async ({ inputData, mastra }) => {
    const dimensions = inputData.plan.query.dimensions ?? [];
    const chart = await runChartRuntime({
      dataset: inputData.dataset,
      intentHint: inputData.plan.chartHint,
      title: inputData.prompt,
      theme: inputData.theme,
      mastra: mastra!,
      preferredXAxisField: dimensions[0],
      preferredGroupByField: dimensions[1],
    });
    return {
      chart,
      dataset: inputData.dataset,
      plan: inputData.plan,
      executedPipeline: inputData.executedPipeline,
    };
  },
});

export const dashboardWorkflow = createWorkflow({
  id: 'dashboard',
  inputSchema: planStep.inputSchema,
  outputSchema: chartStep.outputSchema,
})
  .then(planStep)
  .then(queryStep)
  .then(chartStep)
  .commit();
