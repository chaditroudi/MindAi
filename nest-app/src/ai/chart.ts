import { generateObject }           from 'ai';
import { log, logTrace }             from '../common/logger/app.logger';
import { resolveModel, freshSignal } from './model';
import { buildChartPrompt }          from '../prompts';
import type { DashboardSpec, SkillKind, ChartHint, DataSource } from '../types';

export type { ChartDefinition } from './chart-config';
export { CHART_DEFINITIONS }    from './chart-config';
import { dashboardSchema, CHART_DEFINITIONS } from './chart-config';
import type { LlmWidget, LlmDashboard }       from './chart-config';

import type { DataRow, WidgetPlan } from '../types';
import { buildRowProfile } from './chart-profile';
import { prepareRenderRows } from './chart-aggregation';
import { RENDERERS, mergeChartOptions } from './chart-renderers';
import { repairWidgetPlan, validateWidget, planFieldProps, getFieldValue } from './chart-repair';

// Validate at startup: every visible SKILL.md chart type must have a renderer.
for (const def of CHART_DEFINITIONS) {
  if (!def.llmHidden && !(def.type in RENDERERS)) {
    throw new Error(`No renderer for chart type "${def.type}" — add it to chart-renderers.ts`);
  }
}

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

// ── Entry point ───────────────────────────────────────────────────────────────

const MAX_WIDGETS = Number(process.env['CHART_MAX_WIDGETS'] ?? 3);
const MAX_TOKENS  = Number(process.env['CHART_MAX_TOKENS']  ?? 1000);

export async function runChart(
  rows:          Record<string, unknown>[],
  prompt:        string,
  strategy?:     SkillKind,
  chartHint?:    ChartHint,
  source?:       DataSource,
  apiKey?:       string,
  userModel?:    string,
  userProvider?: string,
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
      model:       resolveModel('chart', apiKey, userModel),
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

  log('chart', `done | widgets: ${widgets.length}${dropped.length ? ` | dropped: ${dropped.length}` : ''} | layout: ${plan.layout}`);

  return { layout: plan.layout, title: prompt, summary: plan.summary, widgets } as DashboardSpec;
}
