import { generateObject }           from 'ai';
import { log, logTrace }             from '../common/logger/app.logger';
import { resolveModel, freshSignal } from './model';
import { buildChartPrompt }          from '../prompts/chart.prompt';
import type { DashboardSpec, SkillKind, ChartHint, DataSource } from '../types';

export type { ChartDefinition } from './chart-config';
export { CHART_DEFINITIONS }    from './chart-config';
import { dashboardSchema }       from './chart-config';
import type { LlmWidget, LlmDashboard } from './chart-config';

import type { DataRow, WidgetPlan } from './chart-types';
import { buildRowProfile, pickFields } from './chart-profile';
import { uniqueStrings, prepareRenderRows } from './chart-aggregation';
import { RENDERERS, mergeChartOptions } from './chart-renderers';
import { repairWidgetPlan, validateWidget, planFieldProps, getFieldValue } from './chart-repair';

// ── Widget rendering ───────────────────────────────────────────────────────────

function renderWidget(plan: WidgetPlan, rows: DataRow[], keys: Set<string>, id: string) {
  for (const prop of planFieldProps(plan.type)) {
    const name = getFieldValue(plan, prop);
    if (name && !keys.has(name)) {
      log('chart', `widget dropped — unknown field "${name}" (${prop}) in ${plan.type}`);
      return null;
    }
  }
  const data   = prepareRenderRows(plan, rows);
  const render = RENDERERS[plan.type];
  return render ? mergeChartOptions(render(plan, data, id), plan.chartOptions) : null;
}

// ── Adaptive fallback ─────────────────────────────────────────────────────────

function synthesizeWidgets(
  profile:   ReturnType<typeof buildRowProfile>,
  rows:      DataRow[],
  strategy?: SkillKind,
  chartHint?: ChartHint,
): WidgetPlan[] {
  const hint     = chartHint?.toLowerCase() ?? '';
  const planMode = strategy?.toLowerCase() ?? '';

  if ((hint === 'scatter' || planMode === 'anomaly') && profile.numeric.length >= 2) {
    return [{ type: 'scatter_plot', title: 'Scatter View', xField: profile.numeric[0], yField: profile.numeric[1], labelField: profile.categorical[0] }];
  }

  if ((hint === 'trend' || planMode === 'trend') && profile.temporal.length && profile.numeric.length) {
    return [{ type: 'line_chart', title: 'Trend', xField: profile.temporal[0], valueField: profile.numeric[0] }];
  }

  if (
    (hint === 'heatmap' || (planMode === 'comparison' && profile.categorical.length >= 2)) &&
    profile.categorical.length >= 2 && profile.numeric.length
  ) {
    return [{ type: 'heatmap', title: 'Cross Breakdown', xField: profile.categorical[0], yField: profile.categorical[1], valueField: profile.numeric[0] }];
  }

  if (profile.categorical.length && profile.numeric.length) {
    const lowCardinality = uniqueStrings(rows, profile.categorical[0]).length <= 6;
    const chartType = hint === 'part_of_whole' && lowCardinality ? 'donut_chart' : 'horizontal_bar_chart';
    return [{
      type: chartType, title: 'Breakdown',
      labelField: profile.categorical[0], valueField: profile.numeric[0],
      ...(chartType === 'horizontal_bar_chart' ? { sortDesc: true } : {}),
    }];
  }

  if (profile.numeric.length) {
    return [{ type: 'kpi_card', title: 'Key Metric', valueField: profile.numeric[0] }];
  }

  return [{ type: 'table', title: 'Data View', columns: profile.all.slice(0, 6) }];
}

// ── Entry point ───────────────────────────────────────────────────────────────

const MAX_WIDGETS = Number(process.env['CHART_MAX_WIDGETS'] ?? 3);
const MAX_TOKENS  = Number(process.env['CHART_MAX_TOKENS']  ?? 1000);

export async function runChart(
  rows:       Record<string, unknown>[],
  prompt:     string,
  strategy?:  SkillKind,
  chartHint?: ChartHint,
  source?:    DataSource,
  apiKey?:    string,
): Promise<DashboardSpec> {
  if (!rows.length) {
    return { layout: 'operational', title: 'No data', summary: 'No rows returned for this request.', widgets: [] };
  }

  log('chart', `rows: ${rows.length} | strategy: ${strategy ?? 'standard'} | hint: ${chartHint ?? '-'} | source: ${source?.name ?? '?'}`);

  const keys    = new Set<string>(rows.flatMap(r => Object.keys(r)));
  const profile = buildRowProfile(keys, rows as DataRow[]);

  let plan: LlmDashboard;
  const t0 = Date.now();
  try {
    const { object } = await generateObject({
      model:       resolveModel('chart', apiKey),
      abortSignal: freshSignal('chart'),
      temperature: 0,
      maxTokens:   MAX_TOKENS,
      maxRetries:  1,
      schema:      dashboardSchema,
      messages:    [{ role: 'user', content: buildChartPrompt(rows, prompt, strategy, chartHint, source) }],
    });
    plan = object;
    log('chart:llm', `done in ${Date.now() - t0}ms | proposed: ${plan.widgets.length} widget(s)`);
    logTrace('chart:llm', 'widget plan', plan);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log('chart', `generateObject failed: ${msg}`);
    throw err;
  }

  const valid:   WidgetPlan[] = [];
  const dropped: string[]     = [];

  for (const w of plan.widgets.slice(0, MAX_WIDGETS)) {
    const repaired = repairWidgetPlan(w as LlmWidget, profile, rows as DataRow[]);
    const check    = validateWidget(repaired, profile, rows as DataRow[]);
    if (check.ok) {
      valid.push(repaired);
      log('chart:llm', `accepted ${w.type} "${w.title}"`);
    } else {
      dropped.push(`${w.type}: ${check.reasons.join('; ')}`);
      log('chart:llm', `rejected ${w.type} — ${check.reasons.join('; ')}`);
    }
  }

  let widgets = valid
    .map((w, i) => renderWidget(w, rows as DataRow[], keys, `w${i + 1}`))
    .filter((w): w is NonNullable<typeof w> => w !== null);

  if (!widgets.length) {
    const fallback = synthesizeWidgets(profile, rows as DataRow[], strategy, chartHint)
      .slice(0, MAX_WIDGETS)
      .map(p => repairWidgetPlan(p as unknown as LlmWidget, profile, rows as DataRow[]));

    widgets = fallback
      .map((w, i) => renderWidget(w, rows as DataRow[], keys, `auto${i + 1}`))
      .filter((w): w is NonNullable<typeof w> => w !== null);

    if (widgets.length) log('chart:auto', `synthesized ${widgets.length} widget(s) from row profile`);
  }

  log('chart', `done | widgets: ${widgets.length}${dropped.length ? ` | dropped: ${dropped.length}` : ''} | layout: ${plan.layout}`);

  return { layout: plan.layout, title: prompt, summary: plan.summary, widgets } as DashboardSpec;
}
