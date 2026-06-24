import type { CoreMessage } from 'ai';
import { aggregate } from './pipeline.js';
import { getSources } from '../db/sources-cache.js';
import { log } from '../utils/logger.js';
import { runReportSkill } from '../ai/writer.js';
import { runChart } from '../ai/chart.js';
import type { DashboardSpec } from '../types/index.js';

function isRateLimitError(err: unknown): boolean {
  const status = (err as { status?: number; statusCode?: number }).status
    ?? (err as { statusCode?: number }).statusCode;
  if (status === 429) return true;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes('429') || msg.includes('rate limit') || msg.includes('quota') || msg.includes('too many requests');
}

function extractRetryDelayMs(err: unknown): number {
  const msg = err instanceof Error ? err.message : String(err);
  const match = /try again in\s+([\d.]+)s/i.exec(msg);
  const seconds = match ? parseFloat(match[1]) : 20;
  return Math.ceil(seconds * 1_000) + 500; // add 500ms buffer
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export type ReportResult = {
  reportSections: { heading: string; body: string }[];
  chart?: DashboardSpec;
};

export async function executeReport(
  prompt:  string,
  context: CoreMessage[] = [],
  apiKey?: string,
): Promise<ReportResult> {
  const { plan, rows } = await aggregate(prompt, 'report', context, apiKey);

  if (!plan.skills.includes('report')) {
    return { reportSections: [{ heading: 'No Data', body: 'The request could not be answered from the available sources.' }] };
  }

  if (!rows.length) {
    return { reportSections: [{ heading: 'No Data', body: 'No matching records found for this request.' }] };
  }

  log('report', `rows: ${rows.length} | prompt: "${prompt}"`);

  if (plan.skills.includes('chart') && rows.length >= 2) {
    const source = getSources().find(s =>
      s.name === plan.query.sourceName || s.collection === plan.query.sourceName,
    );

    const chartFallback = { layout: 'analytical' as const, title: prompt, summary: '', widgets: [] };

    // Fast path: run both in parallel
    try {
      const [reportResult, chartResult] = await Promise.all([
        runReportSkill({ rows, prompt, withChart: true, apiKey }),
        runChart(rows, prompt, plan.strategy, plan.chartHint, source, apiKey)
          .catch(() => chartFallback),
      ]);
      log('report', `done (with chart) | sections: ${reportResult.reportSections.length}`);
      return { ...reportResult, ...(chartResult.widgets.length ? { chart: chartResult } : {}) };
    } catch (err) {
      if (!isRateLimitError(err)) throw err;

      // Rate limit fallback: wait then run sequentially
      const delayMs = extractRetryDelayMs(err);
      log('report', `rate limit on parallel run — waiting ${delayMs}ms then retrying sequentially`);
      await sleep(delayMs);

      const reportResult = await runReportSkill({ rows, prompt, withChart: true, apiKey });
      log('report', `report done (retry) | sections: ${reportResult.reportSections.length}`);
      const chartResult = await runChart(rows, prompt, plan.strategy, plan.chartHint, source, apiKey)
        .catch(() => chartFallback);
      log('report', `done (with chart, retry)`);
      return { ...reportResult, ...(chartResult.widgets.length ? { chart: chartResult } : {}) };
    }
  }

  const result = await runReportSkill({ rows, prompt, apiKey });
  log('report', `done | sections: ${result.reportSections.length}`);
  return result;
}
