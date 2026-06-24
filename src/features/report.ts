import type { CoreMessage } from 'ai';
import { aggregate } from './pipeline.js';
import { getSources } from '../db/sources-cache.js';
import { getCached, setCached } from '../db/prompt-cache.js';
import { log } from '../utils/logger.js';
import { runReportSkill } from '../ai/writer.js';
import { runChart } from '../ai/chart.js';
import type { DashboardSpec } from '../types/index.js';

const CACHE_INTENT = 'report:full';


export type ReportResult = {
  reportSections: { heading: string; body: string }[];
  chart?: DashboardSpec;
};

export async function executeReport(
  prompt:  string,
  context: CoreMessage[] = [],
  apiKey?: string,
): Promise<ReportResult> {
  // Return cached result for the same prompt — avoids burning API quota on retries
  if (!context.length) {
    const cached = await getCached<ReportResult>(CACHE_INTENT, prompt);
    if (cached) {
      log('report', `cache hit — skipping LLM calls`);
      return cached;
    }
  }

  const { plan, rows } = await aggregate(prompt, 'report', context, apiKey);

  if (!plan.skills.includes('report')) {
    return { reportSections: [{ heading: 'No Data', body: 'The request could not be answered from the available sources.' }] };
  }

  if (!rows.length) {
    return { reportSections: [{ heading: 'No Data', body: 'No matching records found for this request.' }] };
  }

  log('report', `rows: ${rows.length} | prompt: "${prompt}"`);

  let result: ReportResult;

  if (plan.skills.includes('chart') && rows.length >= 2) {
    const source = getSources().find(s =>
      s.name === plan.query.sourceName || s.collection === plan.query.sourceName,
    );
    const chartFallback = { layout: 'analytical' as const, title: prompt, summary: '', widgets: [] };

    const reportResult = await runReportSkill({ rows, prompt, withChart: true, apiKey });
    log('report', `report done | sections: ${reportResult.reportSections.length} — generating chart`);
    const chartResult = await runChart(rows, prompt, plan.strategy, plan.chartHint, source, apiKey)
      .catch(() => chartFallback);
    result = { ...reportResult, ...(chartResult.widgets.length ? { chart: chartResult } : {}) };
  } else {
    result = await runReportSkill({ rows, prompt, apiKey });
    log('report', `done | sections: ${result.reportSections.length}`);
  }

  if (!context.length) {
    setCached(CACHE_INTENT, prompt, result).catch(() => undefined);
  }
  return result;
}
