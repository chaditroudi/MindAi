import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { log } from '../../observability/log.js';
import { permissionScopeSchema } from '../schemas/blueprint.js';
import { taskPlanSchema, datasetSchema } from '../schemas/intent.js';
import { chartResultSchema } from '../schemas/chart.js';
import { mergeDatasets } from '../tools/merge-tools.js';
import { runChartRuntime } from '../runtime/chart-runtime.js';
import { runMongoDatasetQuery } from '../runtime/mongodb-runtime.js';
import { runSearchEnrichment } from '../runtime/search-runtime.js';
import { runSupervisorPlan } from '../runtime/supervisor-runtime.js';

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
    return {
      plan: await runSupervisorPlan({
        mastra: mastra!,
        prompt: inputData.prompt,
        intent: inputData.intent ?? 'dashboard',
        scope: inputData.scope,
        topic: inputData.topic,
        blueprintId: inputData.blueprintId,
      }),
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
    const queryResult = await runMongoDatasetQuery({
      plan: inputData.plan,
      scope: inputData.scope,
      mastra,
    });
    return {
      ...inputData,
      primary: queryResult.dataset,
      executedPipeline: queryResult.executedPipeline,
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

    const joinKey = plan.query.dimensions?.[0] ?? Object.keys(primary.schema)[0];
    const enrichment = await runSearchEnrichment({
      mastra: mastra!,
      enrichment: plan.enrichment,
      joinKey,
    });
    const merged = mergeDatasets({
      primary,
      secondary: enrichment,
      joinKey,
      secondaryLabel: 'benchmark',
    });
    log.info('workflow.dashboard.merged', {
      workflow: 'dashboard',
      step: 'enrich',
      joinKey,
      primaryRowCount: primary.rows.length,
      secondaryRowCount: enrichment.rows.length,
      mergedRowCount: merged.rows.length,
    });
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
    const chart = await runChartRuntime({
      mastra: mastra!,
      dataset: inputData.dataset,
      intentHint: inputData.plan.chartHint,
      title: inputData.prompt,
      theme: 'light',
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
  .then(enrichStep)
  .then(chartStep)
  .commit();
