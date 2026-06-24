import type { CoreMessage } from 'ai';
import { aggregate } from './pipeline.js';
import { getSources } from '../db/sources-cache.js';
import { getCached, setCached } from '../db/prompt-cache.js';
import { log } from '../utils/logger.js';
import { runReportSkill } from '../ai/writer.js';
import { runChart } from '../ai/chart.js';
import type { DashboardSpec } from '../types/index.js';

const CACHE_INTENT = 'report:full';

function isRateLimitError(err: unknown): boolean {
  const status = (err as { status?: number; statusCode?: number }).status
    ?? (err as { statusCode?: number }).statusCode;
  if (status === 429) return true;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes('429') || msg.includes('rate limit') || msg.includes('quota') || msg.includes('too many requests');
}

function extractRetryDelayMs(err: unknown): number {
  const msg = err instanceof Error ? err.message : String(err);
  // matches: "17m34.944s" or "17.884s"
  const minsec = /(\d+)m([\d.]+)s/i.exec(msg);
  if (minsec) return (parseInt(minsec[1]) * 60 + parseFloat(minsec[2])) * 1_000 + 500;
  const sec = /try again in\s+([\d.]+)s/i.exec(msg);
  return sec ? Math.ceil(parseFloat(sec[1]) * 1_000) + 500 : 20_000;
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

    // Fast path: run both in parallel
    try {
      const [reportResult, chartResult] = await Promise.all([
        runReportSkill({ rows, prompt, withChart: true, apiKey }),
        runChart(rows, prompt, plan.strategy, plan.chartHint, source, apiKey)
          .catch(() => chartFallback),
      ]);
      log('report', `done (with chart) | sections: ${reportResult.reportSections.length}`);
      result = { ...reportResult, ...(chartResult.widgets.length ? { chart: chartResult } : {}) };
    } catch (err) {
      if (!isRateLimitError(err)) throw err;

      const delayMs = extractRetryDelayMs(err);
      if (delayMs > 60_000) throw err; // quota exhausted — surface immediately, don't hang
      log('report', `rate limit — waiting ${delayMs}ms then retrying sequentially`);
      await sleep(delayMs);

      const reportResult = await runReportSkill({ rows, prompt, withChart: true, apiKey });
      log('report', `report done (retry) | sections: ${reportResult.reportSections.length}`);
      const chartResult = await runChart(rows, prompt, plan.strategy, plan.chartHint, source, apiKey)
        .catch(() => chartFallback);
      result = { ...reportResult, ...(chartResult.widgets.length ? { chart: chartResult } : {}) };
    }
  } else {
    result = await runReportSkill({ rows, prompt, apiKey });
    log('report', `done | sections: ${result.reportSections.length}`);
  }

  if (!context.length) {
    setCached(CACHE_INTENT, prompt, result).catch(() => undefined);
  }
  return result;
}
