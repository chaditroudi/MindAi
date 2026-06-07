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
});

type Ctx = z.infer<typeof analyticsInputSchema>;

async function exec(ctx: Ctx, intent: IntentKind) {
  const sources = getSources();
  const plan    = await runSupervisorPlan({ prompt: ctx.prompt, intent, sourceName: ctx.sourceName, sources });

  if (!plan.needsData || !plan.pipeline?.length) return { plan, rows: [] as Document[] };

  const collection = findSource(plan.query.sourceName ?? '', sources)?.collection
    ?? plan.query.sourceName
    ?? '';

  const rows = await executePipeline({ pipeline: plan.pipeline, collection });
  return { plan, rows };
}

export async function runDashboard(ctx: Ctx) {
  const { plan, rows } = await exec(ctx, 'dashboard');
  return runChartAgent({ rows, prompt: ctx.prompt, intentHint: plan.chartHint });
}

export async function runReport(ctx: Ctx) {
  const { rows } = await exec(ctx, 'report');
  if (!rows.length) return { reportSections: [{ heading: 'No Data', body: 'No matching records found.' }] };
  return runReportWriter({ prompt: ctx.prompt, rows });
}

export async function runInquiry(ctx: Ctx) {
  const { rows } = await exec(ctx, 'general_question');
  if (!rows.length) return { summary: 'No matching data found.' };
  return runInquiryWriter({ prompt: ctx.prompt, rows });
}
