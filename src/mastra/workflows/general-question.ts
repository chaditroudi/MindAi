import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { permissionScopeSchema } from '../schemas/datastore.js';
import { taskPlanSchema, datasetSchema } from '../schemas/intent.js';
import { runMongoRecordFetch } from '../runtime/mongodb-runtime.js';
import { runSearchEnrichment } from '../runtime/search-runtime.js';
import { runSupervisorPlan } from '../runtime/supervisor-runtime.js';
import { runInquiryWriter } from '../runtime/writer-runtime.js';

const planStep = createStep({
  id: 'plan-q',
  inputSchema: z.object({
    prompt: z.string(),
    planningPrompt: z.string().optional(),
    scope: permissionScopeSchema,
    topic: z.string().optional(),
    dataStoreName: z.string().optional(),
  }),
  outputSchema: z.object({
    plan: taskPlanSchema,
    scope: permissionScopeSchema,
    prompt: z.string(),
  }),
  execute: async ({ inputData, mastra }) => {
    return {
      plan: await runSupervisorPlan({
        mastra: mastra!,
        prompt: inputData.prompt,
        planningPrompt: inputData.planningPrompt,
        intent: 'general_question',
        scope: inputData.scope,
        topic: inputData.topic,
        dataStoreName: inputData.dataStoreName,
      }),
      scope: inputData.scope,
      prompt: inputData.prompt,
    };
  },
});

const fetchStep = createStep({
  id: 'fetch-records',
  inputSchema: planStep.outputSchema,
  outputSchema: z.object({
    plan: taskPlanSchema,
    prompt: z.string(),
    dataset: datasetSchema,
    collection: z.string().optional(),
  }),
  execute: async ({ inputData }) => {
    const fetchResult = await runMongoRecordFetch({
      plan: inputData.plan,
      scope: inputData.scope,
    });
    return {
      plan: inputData.plan,
      prompt: inputData.prompt,
      dataset: fetchResult.dataset,
      collection: fetchResult.collection,
    };
  },
});

const enrichStep = createStep({
  id: 'retrieve-context',
  inputSchema: planStep.outputSchema,
  outputSchema: z.object({
    dataset: datasetSchema.optional(),
    collection: z.string().optional(),
  }),
  execute: async ({ inputData, mastra }) => {
    const shouldRetrieveContext =
      inputData.plan.needsEnrichment && Boolean(inputData.plan.enrichment?.topic);

    if (!shouldRetrieveContext) {
      return {};
    }

    const knowledgeDataset = await runSearchEnrichment({
      mastra: mastra!,
      enrichment: inputData.plan.enrichment!,
      tenantId: inputData.scope.tenantId,
      timeRange: inputData.plan.query.timeRange,
      joinKey: inputData.plan.query.dimensions?.[0],
    });

    return {
      dataset: knowledgeDataset,
      collection: knowledgeDataset.rows.length > 0 ? 'knowledge' : undefined,
    };
  },
});

const chooseContextStep = createStep({
  id: 'choose-context',
  inputSchema: z.object({
    'fetch-records': z.object({
      plan: taskPlanSchema,
      prompt: z.string(),
      dataset: datasetSchema,
      collection: z.string().optional(),
    }),
    'retrieve-context': z.object({
      dataset: datasetSchema.optional(),
      collection: z.string().optional(),
    }),
  }),
  outputSchema: z.object({
    plan: taskPlanSchema,
    prompt: z.string(),
    dataset: datasetSchema,
    collection: z.string().optional(),
    enrichment: datasetSchema.optional(),
  }),
  execute: async ({ inputData }) => {
    const retrieved = inputData['retrieve-context'];
    const primary = inputData['fetch-records'];

    return {
      ...primary,
      enrichment: retrieved.dataset,
    };
  },
});

const summarizeStep = createStep({
  id: 'summarize',
  inputSchema: chooseContextStep.outputSchema,
  outputSchema: z.object({
    summary: z.string(),
    recordLinks: z.array(z.object({ collection: z.string(), id: z.string(), label: z.string() })),
    plan: taskPlanSchema,
    dataset: datasetSchema,
    enrichment: datasetSchema.optional(),
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
      enrichment: inputData.enrichment,
    };
  },
});

export const generalQuestionWorkflow = createWorkflow({
  id: 'general-question',
  inputSchema: planStep.inputSchema,
  outputSchema: summarizeStep.outputSchema,
})
  .then(planStep)
  .parallel([fetchStep, enrichStep])
  .then(chooseContextStep)
  .then(summarizeStep)
  .commit();
