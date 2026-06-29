import type { CoreMessage } from 'ai';
import { aggregate } from './pipeline.js';
import { getSources } from '../db/sources-cache.js';
import { runChart } from '../ai/chart.js';
import { getCached, setCached } from '../db/prompt-cache.js';
import { log } from '../utils/logger.js';
import type { DashboardSpec } from '../types/index.js';

const FULL_CACHE_INTENT = 'dashboard:full';

export async function executeDashboard(
  prompt:  string,
  context: CoreMessage[] = [],
  apiKey?: string,
): Promise<DashboardSpec> {
  if (context.length === 0) {
    const cached = await getCached<DashboardSpec>(FULL_CACHE_INTENT, prompt);
    if (cached) {
      log('dashboard', 'full cache hit — skipping both LLM calls');
      return cached;
    }
  }

  const { plan, rows } = await aggregate(prompt, 'dashboard', context, apiKey);

  if (!plan.skills.includes('chart')) {
    throw new Error('Planner did not produce a chart execution path for this request.');
  }
  if (!rows.length) {
    throw new Error('No data found. Try rephrasing your question or checking the data source.');
  }

  const source = getSources().find(s =>
    s.name === plan.query.sourceName || s.collection === plan.query.sourceName,
  );
  const chart = await runChart(rows, prompt, plan.strategy, plan.chartHint, source, apiKey)
    .catch((): DashboardSpec => ({ layout: 'analytical', title: prompt, summary: 'Chart could not be generated.', widgets: [] }));

  if (chart.widgets.length && context.length === 0) {
    setCached(FULL_CACHE_INTENT, prompt, chart).catch(() => undefined);
  }

  return chart;
}
