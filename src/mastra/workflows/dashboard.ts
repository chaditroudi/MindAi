import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { permissionScopeSchema } from '../schemas/blueprint.js';
import { taskPlanSchema, datasetSchema } from '../schemas/intent.js';
import { chartResultSchema } from '../schemas/chart.js';
import { blueprintRepo } from '../../db/blueprint.repository.js';
import { finalizeTaskPlan } from '../task-plan.js';
import {
  buildAggregationFromPlan,
  executePipeline,
  validateRows,
} from '../tools/mongodb-tools.js';
import { buildChartFromDataset } from '../tools/chart-tools.js';

const planStep = createStep({
  id: 'plan',
  inputSchema: z.object({
    prompt: z.string(),
    intent: z.enum(['general_question', 'report', 'dashboard']).optional(),
    scope: permissionScopeSchema,
    topic: z.string().optional(),
    blueprintId: z.string().optional(),
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
            intent: inputData.intent ?? 'dashboard',
            currentDate: new Date().toISOString(),
            topic: inputData.topic,
            blueprintId: inputData.blueprintId,
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
      forcedIntent: inputData.intent ?? 'dashboard',
    }) as z.infer<typeof taskPlanSchema>;
    return {
      plan: finalizedPlan,
      scope: inputData.scope,
      prompt: inputData.prompt,
    };
  },
});

const queryStep = createStep({
  id: 'query',
  inputSchema: z.object({
    plan: taskPlanSchema,
    scope: permissionScopeSchema,
    prompt: z.string(),
  }),
  outputSchema: z.object({
    plan: taskPlanSchema,
    scope: permissionScopeSchema,
    prompt: z.string(),
    primary: datasetSchema,
    executedPipeline: z.array(z.record(z.unknown())),
  }),
  execute: async ({ inputData, mastra }) => {
    const { plan, scope } = inputData;
    if (!plan.needsData || !plan.query.blueprintId || !plan.query.dataStoreName) {
      return {
        ...inputData,
        primary: { rows: [], schema: {}, source: 'mongodb' as const },
        executedPipeline: [],
      };
    }

    const dataStore = await blueprintRepo.findDataStore(plan.query.blueprintId, plan.query.dataStoreName);
    if (!dataStore) throw new Error(`Data store ${plan.query.dataStoreName} not found`);

    const { pipeline } = buildAggregationFromPlan({ plan, dataStore, scope });
    const executed = await executePipeline({
      pipeline,
      collection: dataStore.collection,
      scope,
    });
    const validated = validateRows({ rows: executed.rows, dataStore });

    return {
      ...inputData,
      primary: { rows: validated.rows, schema: validated.schema, source: 'mongodb' as const },
      executedPipeline: pipeline,
    };
  },
});

const enrichStep = createStep({
  id: 'enrich',
  inputSchema: z.object({
    plan: taskPlanSchema,
    scope: permissionScopeSchema,
    prompt: z.string(),
    primary: datasetSchema,
    executedPipeline: z.array(z.record(z.unknown())),
  }),
  outputSchema: z.object({
    plan: taskPlanSchema,
    prompt: z.string(),
    dataset: datasetSchema,
    executedPipeline: z.array(z.record(z.unknown())),
  }),
  execute: async ({ inputData, mastra }) => {
    const { plan, primary } = inputData;
    if (!plan.needsEnrichment || !plan.enrichment) {
      return { plan, prompt: inputData.prompt, dataset: primary, executedPipeline: inputData.executedPipeline };
    }

    const search = mastra!.getAgent('searchAgent');
    const res = await search.generate(
      [{ role: 'user', content: JSON.stringify(plan.enrichment) }],
      { output: datasetSchema },
    );

    const joinKey = plan.query.dimensions?.[0] ?? Object.keys(primary.schema)[0];
    const secondaryByKey = new Map<unknown, number>();
    for (const r of res.object.rows) {
      secondaryByKey.set(r[joinKey], Number(r.value ?? 0));
    }
    const merged = {
      rows: primary.rows.map((r) => ({ ...r, benchmark: secondaryByKey.get(r[joinKey]) ?? null })),
      schema: { ...primary.schema, benchmark: 'number' },
      source: 'merged' as const,
      citations: res.object.citations,
    };
    return { plan, prompt: inputData.prompt, dataset: merged, executedPipeline: inputData.executedPipeline };
  },
});

const chartStep = createStep({
  id: 'chart',
  inputSchema: z.object({
    plan: taskPlanSchema,
    prompt: z.string(),
    dataset: datasetSchema,
    executedPipeline: z.array(z.record(z.unknown())),
  }),
  outputSchema: z.object({
    chart: chartResultSchema,
    dataset: datasetSchema,
    plan: taskPlanSchema,
    executedPipeline: z.array(z.record(z.unknown())),
  }),
  execute: async ({ inputData, mastra }) => {
    const chart = chartResultSchema.parse(
      buildChartFromDataset({
        dataset: inputData.dataset,
        intentHint: inputData.plan.chartHint,
        title: inputData.prompt,
      }),
    );
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
  .then(enrichStep)
  .then(chartStep)
  .commit();
