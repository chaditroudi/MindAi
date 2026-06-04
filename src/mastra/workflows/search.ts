import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { permissionScopeSchema } from '../schemas/datastore.js';
import { datasetSchema } from '../schemas/intent.js';
import { searchPlanSchema, runSearchPlan } from '../agents/search.js';
import { executePipeline, validateRows } from '../../db/aggregation.js';
import { dataStoreSchema } from '../schemas/datastore.js';
import { resolveDataStores, findInDataStores } from '../../db/datastore.repository.js';
import { validatePipelineForDataStore } from '../../db/pipeline-validator.js';
import { runInquiryWriter } from '../agents/writer.js';

const planStep = createStep({
  id: 'search-plan',
  inputSchema: z.object({
    prompt: z.string(),
    scope: permissionScopeSchema,
    dataStoreName: z.string().optional(),
    datastores: z.array(dataStoreSchema).optional(),
  }),
  outputSchema: z.object({
    searchPlan: searchPlanSchema,
    scope: permissionScopeSchema,
    prompt: z.string(),
    datastores: z.array(dataStoreSchema).optional(),
  }),
  execute: async ({ inputData, mastra }) => ({
    searchPlan: await runSearchPlan({
      mastra: mastra!,
      prompt: inputData.prompt,
      scope: inputData.scope,
      dataStoreName: inputData.dataStoreName,
      datastores: inputData.datastores,
    }),
    scope: inputData.scope,
    prompt: inputData.prompt,
    datastores: inputData.datastores,
  }),
});

const fetchStep = createStep({
  id: 'search-fetch',
  inputSchema: planStep.outputSchema,
  outputSchema: z.object({
    searchPlan: searchPlanSchema,
    scope: permissionScopeSchema,
    prompt: z.string(),
    dataset: datasetSchema,
  }),
  execute: async ({ inputData }) => {
    const { searchPlan, scope } = inputData;

    const allStores = await resolveDataStores(scope, inputData.datastores);
    const dataStore = findInDataStores(searchPlan.collection, allStores);
    if (!dataStore) {
      throw new Error(`Search agent selected unknown collection "${searchPlan.collection}".`);
    }

    const validatedPipeline = validatePipelineForDataStore({
      pipeline: searchPlan.pipeline,
      dataStore,
      availableDataStores: allStores,
    });

    const executed = await executePipeline({
      pipeline: validatedPipeline,
      collection: dataStore.collection,
      scope,
    });

    const { rows, schema } = validateRows(executed.rows);

    return {
      ...inputData,
      dataset: { rows, schema, source: 'mongodb' as const },
    };
  },
});

const summarizeStep = createStep({
  id: 'search-summarize',
  inputSchema: fetchStep.outputSchema,
  outputSchema: z.object({
    summary: z.string(),
    searchPlan: searchPlanSchema,
    dataset: datasetSchema,
    recordLinks: z.array(z.object({ collection: z.string(), id: z.string(), label: z.string() })),
  }),
  execute: async ({ inputData, mastra }) => {
    const { searchPlan, dataset, prompt } = inputData;

    const summaryPayload = await runInquiryWriter({
      mastra: mastra!,
      prompt,
      dataset,
    });

    const recordLinks = dataset.rows.slice(0, 10).map((r, i) => ({
      collection: searchPlan.collection,
      id: String(r._id ?? r.id ?? i),
      label: String(r.name ?? r.title ?? r._id ?? `Record ${i + 1}`),
    }));

    return {
      summary: summaryPayload.summary,
      searchPlan,
      dataset,
      recordLinks,
    };
  },
});

export const searchWorkflow = createWorkflow({
  id: 'search',
  inputSchema: planStep.inputSchema,
  outputSchema: summarizeStep.outputSchema,
})
  .then(planStep)
  .then(fetchStep)
  .then(summarizeStep)
  .commit();
