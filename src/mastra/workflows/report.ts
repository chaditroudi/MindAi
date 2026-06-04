import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { permissionScopeSchema } from '../schemas/datastore.js';
import { taskPlanSchema, datasetSchema } from '../schemas/intent.js';
import { chartResultSchema } from '../schemas/chart.js';
import { executePipeline, executePipelineInMemory, validateRows } from '../../db/aggregation.js';
import { dataStoreSchema } from '../schemas/datastore.js';
import { resolveDataStores, findInDataStores } from '../../db/datastore.repository.js';
import { validatePipelineForDataStore } from '../../db/pipeline-validator.js';
import { runChartRuntime } from '../agents/chart.js';
import { runSupervisorPlan } from '../agents/supervisor.js';
import { runReportWriter } from '../agents/writer.js';

const planStep = createStep({
  id: 'plan-report',
  inputSchema: z.object({
    prompt: z.string(),
    planningPrompt: z.string().optional(),
    scope: permissionScopeSchema,
    topic: z.string().optional(),
    dataStoreName: z.string().optional(),
    datastores: z.array(dataStoreSchema).optional(),
    dataset: datasetSchema.optional(),
  }),
  outputSchema: z.object({
    plan: taskPlanSchema,
    scope: permissionScopeSchema,
    prompt: z.string(),
    datastores: z.array(dataStoreSchema).optional(),
    sourceDataset: datasetSchema.optional(),
  }),
  execute: async ({ inputData, mastra }) => ({
    plan: await runSupervisorPlan({
      mastra: mastra!,
      prompt: inputData.prompt,
      planningPrompt: inputData.planningPrompt,
      intent: 'report',
      scope: inputData.scope,
      topic: inputData.topic,
      dataStoreName: inputData.dataStoreName,
      datastores: inputData.datastores,
    }),
    scope: inputData.scope,
    prompt: inputData.prompt,
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
    dataset: datasetSchema,
  }),
  execute: async ({ inputData }) => {
    const { plan, scope } = inputData;
    const emptyDataset = {
      rows: [],
      schema: {},
      source: inputData.sourceDataset?.source ?? 'mongodb' as const,
    };

    if (!plan.needsData) {
      return { ...inputData, dataset: emptyDataset };
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

    return {
      ...inputData,
      dataset: {
        rows,
        schema,
        source: inputData.sourceDataset?.source ?? 'mongodb' as const,
      },
    };
  },
});

const writeReportStep = createStep({
  id: 'write-report',
  inputSchema: queryStep.outputSchema,
  outputSchema: z.object({
    reportSections: z.array(z.object({ heading: z.string(), body: z.string() })),
    plan: taskPlanSchema,
    dataset: datasetSchema,
  }),
  execute: async ({ inputData, mastra }) => {
    const writePayload = await runReportWriter({
      mastra: mastra!,
      prompt: inputData.prompt,
      dataset: inputData.dataset,
    });
    return { reportSections: writePayload.reportSections, plan: inputData.plan, dataset: inputData.dataset };
  },
});

const chartStep = createStep({
  id: 'chart',
  inputSchema: queryStep.outputSchema,
  outputSchema: z.object({
    charts: z.array(chartResultSchema).optional(),
  }),
  execute: async ({ inputData, mastra }) => {
    if (inputData.plan.needsChart && inputData.dataset.rows.length > 0) {
      const dimensions = inputData.plan.query.dimensions ?? [];
      return {
        charts: [
          await runChartRuntime({
            dataset: inputData.dataset,
            intentHint: inputData.plan.chartHint,
            title: inputData.prompt,
            theme: 'light',
            mastra: mastra!,
            preferredXAxisField: dimensions[0],
            preferredGroupByField: dimensions[1],
          }),
        ],
      };
    }
    return {};
  },
});

const finalizeStep = createStep({
  id: 'finalize-report',
  inputSchema: z.object({
    'write-report': z.object({
      reportSections: z.array(z.object({ heading: z.string(), body: z.string() })),
      plan: taskPlanSchema,
      dataset: datasetSchema,
    }),
    chart: z.object({ charts: z.array(chartResultSchema).optional() }),
  }),
  outputSchema: z.object({
    reportSections: z.array(z.object({ heading: z.string(), body: z.string() })),
    charts: z.array(chartResultSchema).optional(),
    plan: taskPlanSchema,
    dataset: datasetSchema,
  }),
  execute: async ({ inputData }) => ({
    reportSections: inputData['write-report'].reportSections,
    charts: inputData.chart.charts,
    plan: inputData['write-report'].plan,
    dataset: inputData['write-report'].dataset,
  }),
});

export const reportWorkflow = createWorkflow({
  id: 'report',
  inputSchema: planStep.inputSchema,
  outputSchema: finalizeStep.outputSchema,
})
  .then(planStep)
  .then(queryStep)
  .parallel([writeReportStep, chartStep])
  .then(finalizeStep)
  .commit();
