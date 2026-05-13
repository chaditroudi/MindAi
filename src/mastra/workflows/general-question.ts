import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { permissionScopeSchema } from '../schemas/blueprint.js';
import { taskPlanSchema, datasetSchema } from '../schemas/intent.js';
import { blueprintRepo } from '../../db/blueprint.repository.js';
import { finalizeTaskPlan } from '../task-plan.js';
import {
  buildAggregationFromPlan,
  executePipeline,
  validateRows,
} from '../tools/mongodb-tools.js';

const planStep = createStep({
  id: 'plan-q',
  inputSchema: z.object({
    prompt: z.string(),
    scope: permissionScopeSchema,
    topic: z.string().optional(),
  }),
  outputSchema: z.object({
    plan: taskPlanSchema,
    scope: permissionScopeSchema,
    prompt: z.string(),
  }),
  execute: async ({ inputData, mastra }) => {
    const supervisor = mastra!.getAgent('supervisorAgent');
    const bps = await blueprintRepo.listAccessible(inputData.scope.allowedBlueprintIds);
    const planResult = await supervisor.generate(
      [
        {
          role: 'user',
          content: JSON.stringify({
            prompt: inputData.prompt,
            intent: 'general_question',
            currentDate: new Date().toISOString(),
            topic: inputData.topic,
            platform: { blueprints: bps },
            scope: { tenantId: inputData.scope.tenantId, allowedBlueprintIds: inputData.scope.allowedBlueprintIds },
          }),
        },
      ],
      { output: taskPlanSchema },
    );
    const plan = planResult.object;
    const finalizedPlan = finalizeTaskPlan({
      plan,
      prompt: inputData.prompt,
      availableBlueprints: bps,
      forcedIntent: 'general_question',
    }) as z.infer<typeof taskPlanSchema>;
    return {
      plan: finalizedPlan,
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
  execute: async ({ inputData, mastra }) => {
    const { plan, scope } = inputData;
    if (!plan.needsData || !plan.query.blueprintId || !plan.query.dataStoreName) {
      return {
        plan,
        prompt: inputData.prompt,
        dataset: { rows: [], schema: {}, source: 'mongodb' as const },
      };
    }
    const ds = await blueprintRepo.findDataStore(plan.query.blueprintId, plan.query.dataStoreName);
    if (!ds) throw new Error('Data Store not found');

    const rawPlan = { ...plan, query: { ...plan.query, aggregation: undefined, dimensions: [] } };

    const { pipeline } = buildAggregationFromPlan({ plan: rawPlan, dataStore: ds, scope });
    const executed = await executePipeline({
      pipeline,
      collection: ds.collection,
      scope,
    });
    const validated = validateRows({ rows: executed.rows, dataStore: ds });

    return {
      plan,
      prompt: inputData.prompt,
      dataset: { rows: validated.rows, schema: validated.schema, source: 'mongodb' as const },
      collection: ds.collection,
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
  }),
  execute: async ({ inputData, mastra }) => {
    const writer = mastra!.getAgent('writerAgent');
    const summaryResult = await writer.generate(
      [
        {
          role: 'system',
          content:
            'Return only a JSON object with the shape { "summary": string }. Do not return a task plan.',
        },
        {
          role: 'user',
          content: `Summarize these records in 2–4 sentences for the user's question. Return JSON: { summary: string }.

Question: ${inputData.prompt}
Records (first 10): ${JSON.stringify(inputData.dataset.rows.slice(0, 10))}`,
        },
      ],
      { output: z.object({ summary: z.string() }) },
    );
    const summaryPayload = summaryResult.object;

    const recordLinks = inputData.dataset.rows.slice(0, 10).map((r, i) => ({
      collection: inputData.collection ?? '',
      id: String(r._id ?? r.id ?? i),
      label: String(r.name ?? r.title ?? r._id ?? `Record ${i + 1}`),
    }));

    return { summary: summaryPayload.summary, recordLinks, plan: inputData.plan };
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
