import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { runSupervisorPlan } from '../agents/supervisor-plan.js';
import { runInquiryWriter, runReportWriter } from '../agents/writer.js';
import { runChartAgent } from '../agents/chart.js';
import { executePipeline } from '../../db/aggregation.js';
import { findSource } from '../../db/source.repository.js';
import { getSources } from '../../db/sources-cache.js';
import { log } from '../../utils/logger.js';
import type { Document } from 'mongodb';
import type { IntentKind } from '../../types/index.js';

export const analyticsInputSchema = z.object({
  prompt:     z.string().describe('The user question or request'),
  sourceName: z.string().optional(),
});

export type AnalyticsInput = z.infer<typeof analyticsInputSchema>;

async function exec(ctx: AnalyticsInput, intent: IntentKind) {
  const sources = getSources();
  log('analytics', `exec() | intent: ${intent} | sources: [${sources.map(s => s.name).join(', ')}]`);

  const plan = await runSupervisorPlan({ prompt: ctx.prompt, intent, sourceName: ctx.sourceName, sources });
  log('analytics', `plan received | needsData: ${plan.needsData} | needsChart: ${plan.needsChart} | chartHint: ${plan.chartHint ?? '-'}`);

  if (!plan.needsData || !plan.pipeline?.length) {
    log('analytics', 'plan says no data needed — skipping pipeline execution');
    return { plan, rows: [] as Document[] };
  }

  const collection = findSource(plan.query.sourceName ?? '', sources)?.collection
    ?? plan.query.sourceName
    ?? '';

  const rows = await executePipeline({ pipeline: plan.pipeline, collection });
  log('analytics', `pipeline executed | collection: "${collection}" | rows returned: ${rows.length}`);
  return { plan, rows };
}

// ─── Callable directly from the router (no Mastra runtime context needed) ────

export async function executeDashboard(ctx: AnalyticsInput) {
  log('analytics', `executeDashboard() | prompt: "${ctx.prompt}"`);
  const { plan, rows } = await exec(ctx, 'dashboard');
  const chart = await runChartAgent({ rows, prompt: ctx.prompt, intentHint: plan.chartHint });
  log('analytics', `executeDashboard() done | chartType: ${chart.chartType} | title: "${chart.title}"`);
  return chart;
}

export async function executeReport(ctx: AnalyticsInput) {
  log('analytics', `executeReport() | prompt: "${ctx.prompt}"`);
  const { rows } = await exec(ctx, 'report');
  if (!rows.length) {
    log('analytics', 'executeReport() — no rows, returning empty report');
    return { reportSections: [{ heading: 'No Data', body: 'No matching records found.' }] };
  }
  const result = await runReportWriter({ prompt: ctx.prompt, rows });
  log('analytics', `executeReport() done | sections: ${result.reportSections.length}`);
  return result;
}

export async function executeInquiry(ctx: AnalyticsInput) {
  log('analytics', `executeInquiry() | prompt: "${ctx.prompt}"`);
  const { rows } = await exec(ctx, 'general_question');
  if (!rows.length) {
    log('analytics', 'executeInquiry() — no rows, returning empty summary');
    return { summary: 'No matching data found.' };
  }
  const result = await runInquiryWriter({ prompt: ctx.prompt, rows });
  log('analytics', `executeInquiry() done | summary length: ${result.summary.length} chars`);
  return result;
}


export const dashboardTool = createTool({
  id:          'build-dashboard',
  description: 'Build a chart or visualization — charts, graphs, plots, trends, distributions.',
  inputSchema:  analyticsInputSchema,
  outputSchema: z.object({ chartType: z.string(), title: z.string(), option: z.record(z.unknown()) }),
  execute: async ({ context: ctx }) => executeDashboard(ctx),
});

export const reportTool = createTool({
  id:          'generate-report',
  description: 'Generate a structured analytical report — analysis, insights, detailed breakdown.',
  inputSchema:  analyticsInputSchema,
  outputSchema: z.object({ reportSections: z.array(z.object({ heading: z.string(), body: z.string() })) }),
  execute: async ({ context: ctx }) => executeReport(ctx),
});

export const inquiryTool = createTool({
  id:          'execute-inquiry',
  description: 'Answer a general analytics question — counts, averages, lists, lookups.',
  inputSchema:  analyticsInputSchema,
  outputSchema: z.object({ summary: z.string() }),
  execute: async ({ context: ctx }) => executeInquiry(ctx),
});
