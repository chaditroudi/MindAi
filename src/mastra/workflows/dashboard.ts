import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { log } from '../../observability/log.js';
import { permissionScopeSchema } from '../schemas/datastore.js';
import { taskPlanSchema, datasetSchema } from '../schemas/intent.js';
import { chartResultSchema } from '../schemas/chart.js';
import { mergeDatasets } from '../tools/merge-tools.js';
import { runChartRuntime } from '../runtime/chart-runtime.js';
import { runMongoDatasetQuery } from '../runtime/mongodb-runtime.js';
import { runSearchEnrichment } from '../runtime/search-runtime.js';
import { runSupervisorPlan } from '../runtime/supervisor-runtime.js';

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
  }),
  outputSchema: z.object({
    plan: taskPlanSchema,
    scope: permissionScopeSchema,
    prompt: z.string(),
    theme: themeSchema,
  }),
  execute: async ({ inputData, mastra }) => {
    return {
      plan: await runSupervisorPlan({
        mastra: mastra!,
        prompt: inputData.prompt,
        planningPrompt: inputData.planningPrompt,
        intent: inputData.intent ?? 'dashboard',
        scope: inputData.scope,
        topic: inputData.topic,
        dataStoreName: inputData.dataStoreName,
      }),
      scope: inputData.scope,
      prompt: inputData.prompt,
      theme: inputData.theme,
    };
  },
});

const queryStep = createStep({
  id: 'query',
  inputSchema: z.object({
    plan: taskPlanSchema,
    scope: permissionScopeSchema,
    prompt: z.string(),
    theme: themeSchema,
  }),
  outputSchema: z.object({
    plan: taskPlanSchema,
    scope: permissionScopeSchema,
    prompt: z.string(),
    theme: themeSchema,
    primary: datasetSchema,
    executedPipeline: z.array(z.record(z.unknown())),
  }),
  execute: async ({ inputData, mastra }) => {
    const queryResult = await runMongoDatasetQuery({
      plan: inputData.plan,
      scope: inputData.scope,
    });
    return {
      ...inputData,
      primary: queryResult.dataset,
      executedPipeline: queryResult.executedPipeline,
    };
  },
});

const enrichmentStep = createStep({
  id: 'enrichment',
  inputSchema: planStep.outputSchema,
  outputSchema: z.object({
    enrichment: datasetSchema.optional(),
  }),
  execute: async ({ inputData, mastra }) => {
    const { plan } = inputData;
    if (!plan.needsEnrichment || !plan.enrichment) {
      return {};
    }

    return {
      enrichment: await runSearchEnrichment({
        mastra: mastra!,
        enrichment: plan.enrichment,
        tenantId: inputData.scope.tenantId,
        timeRange: plan.query.timeRange,
        joinKey: plan.query.dimensions?.[0],
        // Give the agent a schema hint derived from the plan so it names fields correctly
        primarySchema: plan.query.dimensions?.reduce<Record<string, string>>(
          (acc, d) => ({ ...acc, [d]: 'string' }),
          {},
        ),
      }),
    };
  },
});

const mergeStep = createStep({
  id: 'merge',
  inputSchema: z.object({
    query: z.object({
      plan: taskPlanSchema,
      scope: permissionScopeSchema,
      prompt: z.string(),
      theme: themeSchema,
      primary: datasetSchema,
      executedPipeline: z.array(z.record(z.unknown())),
    }),
    enrichment: z.object({
      enrichment: datasetSchema.optional(),
    }),
  }),
  outputSchema: z.object({
    plan: taskPlanSchema,
    prompt: z.string(),
    theme: themeSchema,
    dataset: datasetSchema,
    enrichment: datasetSchema.optional(),
    executedPipeline: z.array(z.record(z.unknown())),
  }),
  execute: async ({ inputData }) => {
    const { plan, primary, prompt, theme, executedPipeline } = inputData.query;
    const enrichment = inputData.enrichment.enrichment;

    if (!enrichment) {
      return { plan, prompt, theme, dataset: primary, executedPipeline };
    }

    const joinKey = plan.query.dimensions?.[0] ?? Object.keys(primary.schema)[0];
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
    return { plan, prompt, theme, dataset: merged, enrichment, executedPipeline };
  },
});

const chartStep = createStep({
  id: 'chart',
  inputSchema: z.object({
    plan: taskPlanSchema,
    prompt: z.string(),
    theme: themeSchema,
    dataset: datasetSchema,
    enrichment: datasetSchema.optional(),
    executedPipeline: z.array(z.record(z.unknown())),
  }),
  outputSchema: z.object({
    chart: chartResultSchema,
    dataset: datasetSchema,
    enrichment: datasetSchema.optional(),
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
      enrichment: inputData.enrichment,
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
  .parallel([queryStep, enrichmentStep])
  .then(mergeStep)
  .then(chartStep)
  .commit();
