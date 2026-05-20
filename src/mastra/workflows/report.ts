import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { permissionScopeSchema } from '../schemas/blueprint.js';
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
        intent: 'report',
        scope: inputData.scope,
        topic: inputData.topic,
        blueprintId: inputData.blueprintId,
      }),
      scope: inputData.scope,
      prompt: inputData.prompt,
    };
  },
});

const gatherStep = createStep({
  id: 'gather',
  inputSchema: planStep.outputSchema,
  outputSchema: z.object({
    plan: taskPlanSchema,
    scope: permissionScopeSchema,
    prompt: z.string(),
    dataset: datasetSchema,
    enrichment: datasetSchema.optional(),
  }),
  execute: async ({ inputData, mastra }) => {
    const queryResult = await runMongoDatasetQuery({
      plan: inputData.plan,
      scope: inputData.scope,
      mastra,
    });
    let enrichment: z.infer<typeof datasetSchema> | undefined;
    if (inputData.plan.needsEnrichment && inputData.plan.enrichment) {
      enrichment = await runSearchEnrichment({
        mastra: mastra!,
        enrichment: inputData.plan.enrichment,
        joinKey: inputData.plan.query.dimensions?.[0],
      });
    }

    return {
      plan: inputData.plan,
      scope: inputData.scope,
      prompt: inputData.prompt,
      dataset: queryResult.dataset,
      enrichment,
    };
  },
});

const writeStep = createStep({
  id: 'write-report',
  inputSchema: gatherStep.outputSchema,
  outputSchema: z.object({
    reportSections: z.array(z.object({ heading: z.string(), body: z.string() })),
    charts: z.array(chartResultSchema).optional(),
    plan: taskPlanSchema,
  }),
  execute: async ({ inputData, mastra }) => {
    const writePayload = await runReportWriter({
      mastra: mastra!,
      prompt: inputData.prompt,
      dataset: inputData.dataset,
      enrichment: inputData.enrichment,
    });

    let charts: z.infer<typeof chartResultSchema>[] | undefined;
    if (inputData.plan.needsChart && inputData.dataset.rows.length > 0) {
      charts = [
        await runChartRuntime({
          mastra: mastra!,
          dataset: inputData.dataset,
          intentHint: inputData.plan.chartHint,
          title: inputData.prompt,
          theme: 'light',
        }),
      ];
    }

    return { reportSections: writePayload.reportSections, charts, plan: inputData.plan };
  },
});

export const reportWorkflow = createWorkflow({
  id: 'report',
  inputSchema: planStep.inputSchema,
  outputSchema: writeStep.outputSchema,
})
  .then(planStep)
  .then(gatherStep)
  .then(writeStep)
  .commit();
