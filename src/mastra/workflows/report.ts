import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { permissionScopeSchema } from '../schemas/datastore.js';
import { taskPlanSchema, datasetSchema } from '../schemas/intent.js';
import { chartResultSchema } from '../schemas/chart.js';
import { runChartRuntime } from '../runtime/chart-runtime.js';
import { runMongoDatasetQuery } from '../runtime/mongodb-runtime.js';
import { runSearchEnrichment } from '../runtime/search-runtime.js';
import { runSupervisorPlan } from '../runtime/supervisor-runtime.js';
import { runReportWriter } from '../runtime/writer-runtime.js';

const planStep = createStep({
  id: 'plan-report',
  inputSchema: z.object({
    prompt: z.string(),
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
        intent: 'report',
        scope: inputData.scope,
        topic: inputData.topic,
        dataStoreName: inputData.dataStoreName,
      }),
      scope: inputData.scope,
      prompt: inputData.prompt,
    };
  },
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
  execute: async ({ inputData, mastra }) => {
    const queryResult = await runMongoDatasetQuery({
      plan: inputData.plan,
      scope: inputData.scope,
      mastra: mastra!,
    });

    return {
      plan: inputData.plan,
      scope: inputData.scope,
      prompt: inputData.prompt,
      dataset: queryResult.dataset,
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
    if (!inputData.plan.needsEnrichment || !inputData.plan.enrichment) {
      return {};
    }

    return {
      enrichment: await runSearchEnrichment({
        mastra: mastra!,
        enrichment: inputData.plan.enrichment,
        timeRange: inputData.plan.query.timeRange,
        joinKey: inputData.plan.query.dimensions?.[0],
        primarySchema: inputData.plan.query.dimensions?.reduce<Record<string, string>>(
          (acc, d) => ({ ...acc, [d]: 'string' }),
          {},
        ),
      }),
    };
  },
});

const gatherStep = createStep({
  id: 'gather',
  inputSchema: z.object({
    query: z.object({
      plan: taskPlanSchema,
      scope: permissionScopeSchema,
      prompt: z.string(),
      dataset: datasetSchema,
    }),
    enrichment: z.object({
      enrichment: datasetSchema.optional(),
    }),
  }),
  outputSchema: z.object({
    plan: taskPlanSchema,
    scope: permissionScopeSchema,
    prompt: z.string(),
    dataset: datasetSchema,
    enrichment: datasetSchema.optional(),
  }),
  execute: async ({ inputData }) => {
    return {
      ...inputData.query,
      enrichment: inputData.enrichment.enrichment,
    };
  },
});

const writeReportStep = createStep({
  id: 'write-report',
  inputSchema: gatherStep.outputSchema,
  outputSchema: z.object({
    reportSections: z.array(z.object({ heading: z.string(), body: z.string() })),
    plan: taskPlanSchema,
    enrichment: datasetSchema.optional(),
  }),
  execute: async ({ inputData, mastra }) => {
    const writePayload = await runReportWriter({
      mastra: mastra!,
      prompt: inputData.prompt,
      dataset: inputData.dataset,
      enrichment: inputData.enrichment,
    });

    return { reportSections: writePayload.reportSections, plan: inputData.plan, enrichment: inputData.enrichment };
  },
});

const chartStep = createStep({
  id: 'chart',
  inputSchema: gatherStep.outputSchema,
  outputSchema: z.object({
    charts: z.array(chartResultSchema).optional(),
  }),
  execute: async ({ inputData, mastra }) => {
    if (inputData.plan.needsChart && inputData.dataset.rows.length > 0) {
      return {
        charts: [
          await runChartRuntime({
            dataset: inputData.dataset,
            intentHint: inputData.plan.chartHint,
            title: inputData.prompt,
            theme: 'light',
            mastra: mastra!,
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
      enrichment: datasetSchema.optional(),
    }),
    chart: z.object({
      charts: z.array(chartResultSchema).optional(),
    }),
  }),
  outputSchema: z.object({
    reportSections: z.array(z.object({ heading: z.string(), body: z.string() })),
    charts: z.array(chartResultSchema).optional(),
    plan: taskPlanSchema,
    enrichment: datasetSchema.optional(),
  }),
  execute: async ({ inputData }) => {
    return {
      reportSections: inputData['write-report'].reportSections,
      charts: inputData.chart.charts,
      plan: inputData['write-report'].plan,
      enrichment: inputData['write-report'].enrichment,
    };
  },
});

export const reportWorkflow = createWorkflow({
  id: 'report',
  inputSchema: planStep.inputSchema,
  outputSchema: finalizeStep.outputSchema,
})
  .then(planStep)
  .parallel([queryStep, enrichmentStep])
  .then(gatherStep)
  .parallel([writeReportStep, chartStep])
  .then(finalizeStep)
  .commit();
