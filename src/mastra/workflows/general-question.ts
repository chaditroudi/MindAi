import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { permissionScopeSchema } from '../schemas/datastore.js';
import { taskPlanSchema, datasetSchema } from '../schemas/intent.js';
import { executePipeline, executePipelineInMemory, validateRows } from '../../db/aggregation.js';
import { dataStoreSchema } from '../schemas/datastore.js';
import { resolveDataStores, findInDataStores } from '../../db/datastore.repository.js';
import { validatePipelineForDataStore } from '../../db/pipeline-validator.js';
import { runSupervisorPlan } from '../agents/supervisor.js';
import { runInquiryWriter } from '../agents/writer.js';

const planStep = createStep({
  id: 'plan-q',
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
      intent: 'general_question',
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

const fetchStep = createStep({
  id: 'fetch-records',
  inputSchema: planStep.outputSchema,
  outputSchema: z.object({
    plan: taskPlanSchema,
    prompt: z.string(),
    scope: permissionScopeSchema,
    dataset: datasetSchema,
    collection: z.string().optional(),
  }),
  execute: async ({ inputData }) => {
    const { plan, scope } = inputData;
    const emptyDataset = {
      rows: [],
      schema: {},
      source: inputData.sourceDataset?.source ?? 'mongodb' as const,
    };

    if (!plan.needsData) {
      return { ...inputData, dataset: emptyDataset, collection: undefined };
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
      collection: dataStore.collection,
    };
  },
});

const summarizeStep = createStep({
  id: 'summarize',
  inputSchema: fetchStep.outputSchema,
  outputSchema: z.object({
    summary: z.string(),
    recordLinks: z.array(z.object({ collection: z.string(), id: z.string(), label: z.string() })),
    plan: taskPlanSchema,
    dataset: datasetSchema,
  }),
  execute: async ({ inputData, mastra }) => {
    const summaryPayload = await runInquiryWriter({
      mastra: mastra!,
      prompt: inputData.prompt,
      dataset: inputData.dataset,
    });

    const recordLinks = inputData.dataset.rows.slice(0, 10).map((r, i) => ({
      collection: inputData.collection ?? '',
      id: String(r._id ?? r.id ?? i),
      label: String(r.name ?? r.title ?? r._id ?? `Record ${i + 1}`),
    }));

    return {
      summary: summaryPayload.summary,
      recordLinks,
      plan: inputData.plan,
      dataset: inputData.dataset,
    };
  },
});

export const generalQuestionWorkflow = createWorkflow({
  id: 'general-question',
  inputSchema: planStep.inputSchema,
  outputSchema: summarizeStep.outputSchema,
})
  .then(planStep)
  .then(fetchStep)
  .then(summarizeStep)
  .commit();
