import type { CoreMessage } from 'ai';
import { aggregate } from './pipeline';
import { getSources } from '../sources/sources-cache';
import { log } from '../common/logger/app.logger';
import { runReportSkill } from '../ai/writer';
import { runChart } from '../ai/chart';
import type { DashboardSpec } from '../types';

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
    const [reportResult, chartResult] = await Promise.all([
      runReportSkill({ rows, prompt, withChart: true, apiKey }),
      runChart(rows, prompt, plan.strategy, plan.chartHint, source, apiKey)
        .catch(() => ({ layout: 'analytical' as const, title: prompt, summary: '', widgets: [] })),
    ]);
    log('report', `done (with chart) | sections: ${reportResult.reportSections.length}`);
    return { ...reportResult, ...(chartResult.widgets.length ? { chart: chartResult } : {}) };
  }

  const result = await runReportSkill({ rows, prompt, apiKey });
  log('report', `done | sections: ${result.reportSections.length}`);
  return result;
}
