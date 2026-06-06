import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { runSupervisorPlan } from '../agents/supervisor-plan.js';
import { runInquiryWriter, runReportWriter } from '../agents/writer.js';
import { runChartRuntime } from '../agents/chart.js';
import { executePipeline, executePipelineInMemory, validateRows } from '../../db/aggregation.js';
import { findSource } from '../../db/source.repository.js';
import type { DataSource, PermissionScope } from '../../types/index.js';

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const analyticsToolInputSchema = z.object({
  prompt:        z.string().describe('The user question or request'),
  scope:         z.object({
    userId: z.string().default(''), tenantId: z.string().default(''),
    allowedSources: z.array(z.string()).optional(),
    rowFilter: z.record(z.unknown()).optional(),
  }).default({}),
  sourceName:    z.string().optional(),
  sources:       z.array(z.unknown()).optional(),
  rows:          z.array(z.record(z.unknown())).optional(),
});

const rowSchema   = z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]));
const datasetOut  = z.object({ rows: z.array(rowSchema), schema: z.record(z.string()), source: z.enum(['mongodb', 'search', 'merged']) });
const sectionOut  = z.object({ heading: z.string(), body: z.string() });

type Ctx = z.infer<typeof analyticsToolInputSchema>;
type Intent = 'general_question' | 'report' | 'dashboard';

// ─── Shared helper: plan + execute ───────────────────────────────────────────

async function exec(ctx: Ctx, intent: Intent) {
  const scope = ctx.scope as unknown as PermissionScope;
  const sources = ctx.sources as DataSource[] | undefined;
  const plan  = await runSupervisorPlan({ prompt: ctx.prompt, intent, scope, sourceName: ctx.sourceName, sources });
  const empty = { rows: [] as z.infer<typeof rowSchema>[], schema: {} as Record<string, string>, source: 'mongodb' as const };

  if (!plan.needsData || !plan.pipeline?.length) return { plan, dataset: empty, empty: true };

  const rawRows = ctx.rows?.length
    ? executePipelineInMemory({ pipeline: plan.pipeline, rows: ctx.rows, scope }).rows
    : (await executePipeline({
        pipeline:   plan.pipeline,
        collection: findSource(plan.query.sourceName ?? '', sources ?? [])?.collection
          ?? plan.query.sourceName
          ?? '',
        scope,
      })).rows;

  const { rows, schema } = validateRows(rawRows);
  return { plan, dataset: { rows, schema, source: 'mongodb' as const }, empty: false };
}

// ─── Tools ────────────────────────────────────────────────────────────────────

export const inquiryTool = createTool({
  id: 'execute-inquiry',
  description: 'Answer a general analytics question — counts, averages, lists, lookups, "how many", "show me", "find".',
  inputSchema:  analyticsToolInputSchema,
  outputSchema: z.object({ summary: z.string(), dataset: datasetOut }),
  execute: async ({ context: ctx }) => {
    const { dataset, empty } = await exec(ctx, 'general_question');
    if (empty) return { summary: 'No matching data found.', dataset };
    return { summary: (await runInquiryWriter({ prompt: ctx.prompt, dataset })).summary, dataset };
  },
});

export const dashboardTool = createTool({
  id: 'build-dashboard',
  description: 'Build a chart or visualization — charts, graphs, plots, "visualize", "show a chart of", trends, distributions.',
  inputSchema:  analyticsToolInputSchema,
  outputSchema: z.object({ chart: z.unknown(), dataset: datasetOut }),
  execute: async ({ context: ctx }) => {
    const { plan, dataset } = await exec(ctx, 'dashboard');
    const chart = await runChartRuntime({ dataset, intentHint: plan.chartHint as Parameters<typeof runChartRuntime>[0]['intentHint'], title: ctx.prompt });
    return { chart, dataset };
  },
});

export const reportTool = createTool({
  id: 'generate-report',
  description: 'Generate a structured analytical report — "write a report", "analyze", "give me an analysis", "detailed report on".',
  inputSchema:  analyticsToolInputSchema,
  outputSchema: z.object({ reportSections: z.array(sectionOut), dataset: datasetOut }),
  execute: async ({ context: ctx }) => {
    const { dataset, empty } = await exec(ctx, 'report');
    if (empty) return { reportSections: [{ heading: 'No Data', body: 'No matching records found.' }], dataset };
    return { ...(await runReportWriter({ prompt: ctx.prompt, dataset })), dataset };
  },
});
