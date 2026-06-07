import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { runSupervisorPlan } from '../agents/supervisor-plan.js';
import { runInquiryWriter, runReportWriter } from '../agents/writer.js';
import { runChartAgent } from '../agents/chart.js';
import { executePipeline } from '../../db/aggregation.js';
import { findSource } from '../../db/source.repository.js';
import { getSources } from '../../db/sources-cache.js';
import type { Document } from 'mongodb';
import type { IntentKind } from '../../types/index.js';

export const analyticsInputSchema = z.object({
  prompt:     z.string().describe('The user question or request'),
  sourceName: z.string().optional(),
  intent:     z.string().optional().describe('Selected mode: dashboard | report | general_question'),
});

type Ctx = z.infer<typeof analyticsInputSchema>;

const MODE_PREFIX = /^\[Mode:[^\]]+\]\s*/;

async function exec(ctx: Ctx, intent: IntentKind) {
  const sources     = getSources();
  const cleanPrompt = ctx.prompt.replace(MODE_PREFIX, '');
  const plan        = await runSupervisorPlan({ prompt: cleanPrompt, intent, sourceName: ctx.sourceName, sources });

  if (!plan.needsData || !plan.pipeline?.length) return { plan, rows: [] as Document[] };

  const collection = findSource(plan.query.sourceName ?? '', sources)?.collection
    ?? plan.query.sourceName
    ?? '';

  const rows = await executePipeline({ pipeline: plan.pipeline, collection });
  return { plan, rows };
}

export const inquiryTool = createTool({
  id:          'execute-inquiry',
  description: 'Answer a general analytics question — counts, averages, lists, lookups.',
  inputSchema:  analyticsInputSchema,
  outputSchema: z.object({ summary: z.string() }),
  execute: async ({ context: ctx }) => {
    const cleanPrompt = ctx.prompt.replace(MODE_PREFIX, '');
    const { rows }    = await exec(ctx, 'general_question');
    if (!rows.length) return { summary: 'No matching data found.' };
    return runInquiryWriter({ prompt: cleanPrompt, rows });
  },
});

export const dashboardTool = createTool({
  id:          'build-dashboard',
  description: 'Build a chart or visualization — charts, graphs, plots, trends, distributions.',
  inputSchema:  analyticsInputSchema,
  outputSchema: z.object({ chartType: z.string(), title: z.string(), option: z.record(z.unknown()) }),
  execute: async ({ context: ctx }) => {
    const cleanPrompt    = ctx.prompt.replace(MODE_PREFIX, '');
    const { plan, rows } = await exec(ctx, 'dashboard');
    return runChartAgent({ rows, prompt: cleanPrompt, intentHint: plan.chartHint });
  },
});

export const reportTool = createTool({
  id:          'generate-report',
  description: 'Generate a structured analytical report — analysis, insights, detailed breakdown.',
  inputSchema:  analyticsInputSchema,
  outputSchema: z.object({ reportSections: z.array(z.object({ heading: z.string(), body: z.string() })) }),
  execute: async ({ context: ctx }) => {
    const cleanPrompt = ctx.prompt.replace(MODE_PREFIX, '');
    const { rows }    = await exec(ctx, 'report');
    if (!rows.length) return { reportSections: [{ heading: 'No Data', body: 'No matching records found.' }] };
    return runReportWriter({ prompt: cleanPrompt, rows });
  },
});
