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
    const supervisor = mastra!.getAgent('supervisorAgent');
    const bps = await blueprintRepo.listAccessible(inputData.scope.allowedBlueprintIds);
    const planResult = await supervisor.generate(
      [
        {
          role: 'user',
          content: JSON.stringify({
            prompt: inputData.prompt,
            intent: 'report',
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
      forcedIntent: 'report',
    }) as z.infer<typeof taskPlanSchema>;
    return {
      plan: finalizedPlan,
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
    const { plan, scope } = inputData;
    const empty: z.infer<typeof datasetSchema> = { rows: [], schema: {}, source: 'mongodb' };

    let dataset = empty;
    if (plan.needsData && plan.query.blueprintId && plan.query.dataStoreName) {
      const ds = await blueprintRepo.findDataStore(plan.query.blueprintId, plan.query.dataStoreName);
      if (ds) {
        const { pipeline } = buildAggregationFromPlan({ plan, dataStore: ds, scope });
        const executed = await executePipeline({
          pipeline,
          collection: ds.collection,
          scope,
        });
        const validated = validateRows({ rows: executed.rows, dataStore: ds });
        dataset = { rows: validated.rows, schema: validated.schema, source: 'mongodb' };
      }
    }

    let enrichment: z.infer<typeof datasetSchema> | undefined;
    if (plan.needsEnrichment && plan.enrichment) {
      const search = mastra!.getAgent('searchAgent');
      const r = await search.generate(
        [{ role: 'user', content: JSON.stringify(plan.enrichment) }],
        { output: datasetSchema },
      );
      enrichment = r.object;
    }

    return { plan, scope, prompt: inputData.prompt, dataset, enrichment };
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
    const writer = mastra!.getAgent('writerAgent');
    const reportOutputSchema = z.object({
      reportSections: z.array(z.object({ heading: z.string(), body: z.string() })),
    });
    const writeResult = await writer.generate(
      [
        {
          role: 'system',
          content:
            'Return only a JSON object with the shape { "reportSections": [{ "heading": string, "body": string }] }. Do not return a task plan.',
        },
        {
          role: 'user',
          content: `Write a structured report based on the following data. Return JSON with reportSections: [{heading, body}].

User prompt: ${inputData.prompt}
Dataset: ${JSON.stringify(inputData.dataset).slice(0, 8000)}
External context: ${JSON.stringify(inputData.enrichment ?? null).slice(0, 4000)}`,
        },
      ],
      { output: reportOutputSchema },
    );
    const writePayload = writeResult.object;

    let charts: z.infer<typeof chartResultSchema>[] | undefined;
    if (inputData.plan.needsChart && inputData.dataset.rows.length > 0) {
      charts = [
        chartResultSchema.parse(
          buildChartFromDataset({
            dataset: inputData.dataset,
            intentHint: inputData.plan.chartHint,
            title: inputData.prompt,
          }),
        ),
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
