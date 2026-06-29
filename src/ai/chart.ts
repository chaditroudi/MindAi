import { generateObject } from 'ai';
import { z } from 'zod';
import { log, logTrace } from '../utils/logger.js';
import { resolveModel, freshSignal } from './model.js';
import { readJsonSection } from './skill-prompt.js';
import { buildChartPrompt } from '../prompts/chart.prompt.js';
import { chartRepo } from '../db/chart-results.repository.js';
import type { DashboardSpec, SkillKind, ChartHint, DataSource } from '../types/index.js';

export interface ChartDefinition {
  type:                string;
  requiredFields:      string[];
  optionalFields:      string[];
  optionalPlanFields?: string[];
  llmHidden?:          boolean;
  requiresAxis?:       boolean;
  requiresLabel?:      boolean;
  requiresSeries?:     boolean;
  requiresXY?:         boolean;
  requiresValue?:      boolean;
}
  
interface SkillConfig {
  aggregations: string[];
  layouts:      string[];
  types:        ChartDefinition[];
}

const SKILL_FILE = new URL('../../skills/chart/SKILL.md', import.meta.url);
const cfg = readJsonSection<SkillConfig>(SKILL_FILE, 'Chart Config');

export const CHART_DEFINITIONS: readonly ChartDefinition[] = cfg.types;

const CHART_AGGREGATIONS     = cfg.aggregations as [string, ...string[]];
const LLM_CHART_AGGREGATIONS = [...CHART_AGGREGATIONS, 'none'] as [string, ...string[]];
const DASHBOARD_LAYOUTS      = cfg.layouts      as [string, ...string[]];

type ChartType = string;
type DataRow   = Record<string, unknown>;
type ChartAgg  = typeof CHART_AGGREGATIONS[number];

const CHART_BY_TYPE = Object.fromEntries(cfg.types.map(d => [d.type, d])) as Record<string, ChartDefinition>;

function getLlmChartTypes(): [ChartType, ...ChartType[]] {
  return cfg.types.filter(d => !d.llmHidden).map(d => d.type) as [ChartType, ...ChartType[]];
}

// widget schema

const chartOptionsSchema = z.object({
  color:   z.array(z.string()).optional(),
  legend:  z.record(z.unknown()).optional(),
  tooltip: z.record(z.unknown()).optional(),
  title:   z.record(z.unknown()).optional(),
  grid:    z.record(z.unknown()).optional(),
}).optional();

// WidgetPlan = internal only, no runtime validation. Zod schema is LLM-facing only.
interface WidgetPlan {
  type:          string;
  title:         string;
  insight?:      string;
  labelField?:   string;
  valueField?:   string;
  xField?:       string;
  yField?:       string;
  seriesField?:  string;
  columns?:      string[];
  agg?:          ChartAgg;
  sortDesc?:     boolean;
  topN?:         number;
  chartOptions?: z.infer<typeof chartOptionsSchema>;
}

// renderers by chart type
// render fns only here — field requirements are in SKILL.md (CHART_BY_TYPE)

type Renderer = (plan: WidgetPlan, data: DataRow[], id: string) => unknown;

const RENDERERS: Record<string, Renderer> = {
  bar_chart:             renderBar,
  horizontal_bar_chart:  renderBar,
  grouped_bar_chart:     (p, d, i) => renderMultiBar(p, d, i, false),
  stacked_bar_chart:     (p, d, i) => renderMultiBar(p, d, i, true),
  line_chart:            renderLine,
  area_chart:            renderLine,
  multi_line_chart:      renderMultiLine,
  donut_chart:           renderDonut,
  scatter_plot:          renderScatter,
  kpi_card:              renderKpi,
  gauge_chart:           renderGauge,
  funnel_chart:          renderFunnel,
  radar_chart:           renderRadar,
  heatmap:               renderHeatmap,
  table:                 renderTable,
};




const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0);
const str = (v: unknown): string => (v == null ? '' : String(v));

function deepMerge(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
  const result = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v) &&
        typeof result[k] === 'object' && result[k] !== null && !Array.isArray(result[k])) {
      result[k] = deepMerge(result[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      result[k] = v;
    }
  }
  return result;
}

function resolveCategoryField(plan: Pick<WidgetPlan, 'labelField' | 'xField'>) {
  return plan.labelField ?? plan.xField;
}

function resolveAxisField(plan: Pick<WidgetPlan, 'labelField' | 'xField'>) {
  return plan.xField ?? plan.labelField;
}

function uniqueStrings(rows: DataRow[], field: string) {
  return [...new Set(rows.map(r => str(r[field])))];
}

function resolveNumericValueField(data: DataRow[], valueField?: string) {
  return valueField ?? Object.keys(data[0] ?? {}).find(k => typeof data[0]?.[k] === 'number');
}

function sumMatchingValues(rows: DataRow[], lf: string, label: string, sf: string, group: string, vf: string) {
  return rows.reduce((s, r) => (str(r[lf]) === label && str(r[sf]) === group ? s + num(r[vf]) : s), 0);
}

function findSeriesPoint(rows: DataRow[], xf: string, xv: string, sf: string, group: string, vf: string) {
  const r = rows.find(row => str(row[xf]) === xv && str(row[sf]) === group);
  return r != null ? num(r[vf]) : null;
}

function prepareRenderRows(plan: WidgetPlan, rows: DataRow[]) {
  const data = [...rows];
  if (plan.sortDesc && plan.valueField && !plan.agg) data.sort((a, b) => num(b[plan.valueField!]) - num(a[plan.valueField!]));
  if (plan.topN && !plan.agg) return data.slice(0, plan.topN);
  return data;
}

function mergeChartOptions(rendered: unknown, chartOptions: WidgetPlan['chartOptions']) {
  if (!rendered || !chartOptions) return rendered;
  const result = rendered as Record<string, unknown>;
  if (typeof result.option === 'object' && result.option !== null) {
    return { ...result, option: deepMerge(result.option as Record<string, unknown>, chartOptions) };
  }
  return rendered;
}

function buildCategoricalSeries(plan: WidgetPlan, rows: DataRow[]) {
  const lf = resolveCategoryField(plan);
  if (!lf) return [];
  const series = plan.agg
    ? aggregateByLabel(rows, lf, plan.agg, plan.valueField)
    : buildDirectSeries(rows, lf, plan.valueField);
  if (!series.length) return [];
  const sorted = plan.sortDesc ? [...series].sort((a, b) => b.value - a.value) : series;
  return plan.topN ? sorted.slice(0, plan.topN) : sorted;
}

function buildDirectSeries(rows: DataRow[], lf: string, vf?: string) {
  if (!vf) return [];
  return rows.map(r => ({ label: str(r[lf]), value: num(r[vf]) })).filter(i => i.label);
}

function aggregateByLabel(rows: DataRow[], lf: string, agg: WidgetPlan['agg'], vf?: string) {
  const buckets = new Map<string, number[]>();
  for (const row of rows) {
    const label = str(row[lf]).trim();
    if (!label) continue;
    let vals = buckets.get(label);
    if (!vals) buckets.set(label, (vals = []));
    if (agg === 'count') vals.push(1);
    else if (vf) { const v = num(row[vf]); if (Number.isFinite(v)) vals.push(v); }
  }
  return [...buckets.entries()]
    .map(([label, vals]) => ({ label, value: aggregateValues(vals, agg) }))
    .filter(i => Number.isFinite(i.value));
}

function aggregateValues(vals: number[], agg: WidgetPlan['agg']) {
  if (!vals.length || !agg) return Number.NaN;
  if (agg === 'count') return vals.length;
  if (agg === 'sum')   return vals.reduce((a, b) => a + b, 0);
  if (agg === 'avg')   return vals.reduce((a, b) => a + b, 0) / vals.length;
  if (agg === 'min')   return Math.min(...vals);
  return Math.max(...vals);
}

function sortLineData(rows: DataRow[], field: string) {
  const mode = detectAxisMode(rows, field);
  if (mode === 'preserve') return [...rows];
  return [...rows].sort((a, b) => compareAxisValue(a[field], b[field], mode));
}

function detectAxisMode(rows: DataRow[], field: string): 'number' | 'date' | 'preserve' {
  const vals = rows.map(r => r[field]).filter(v => v != null);
  if (!vals.length) return 'preserve';
  if (vals.every(v => v !== '' && Number.isFinite(Number(v)))) return 'number';
  if (vals.every(v => !Number.isNaN(new Date(String(v)).getTime()))) return 'date';
  return 'preserve';
}

function compareAxisValue(a: unknown, b: unknown, mode: 'number' | 'date') {
  return mode === 'number'
    ? Number(a) - Number(b)
    : new Date(String(a)).getTime() - new Date(String(b)).getTime();
}

const widget = (plan: WidgetPlan, id: string, option: Record<string, unknown>) =>
  ({ id, type: plan.type, title: plan.title, insight: plan.insight, option });

// actual render functions below

function renderBar(plan: WidgetPlan, data: DataRow[], id: string) {
  const series = buildCategoricalSeries(plan, data);
  if (!series.length) return null;
  const labels = series.map(i => i.label);
  const values = series.map(i => i.value);
  const h = plan.type === 'horizontal_bar_chart';
  return widget(plan, id, {
    tooltip: { trigger: 'axis' },
    grid:    { containLabel: true, ...(h ? { left: '3%' } : {}) },
    xAxis:   h ? { type: 'value' } : { type: 'category', data: labels },
    yAxis:   h ? { type: 'category', data: labels.slice().reverse() } : { type: 'value' },
    series:  [{ type: 'bar', data: h ? values.slice().reverse() : values, itemStyle: { borderRadius: 4 } }],
  });
}

function renderMultiBar(plan: WidgetPlan, data: DataRow[], id: string, stacked: boolean) {
  const lf = resolveCategoryField(plan);
  if (!lf || !plan.valueField || !plan.seriesField) return null;
  const labels  = uniqueStrings(data, lf);
  const groups  = uniqueStrings(data, plan.seriesField);
  const series  = groups.map(g => ({
    name: g, type: 'bar',
    ...(stacked ? { stack: 'total' } : {}),
    itemStyle: { borderRadius: stacked ? 0 : 2 },
    data: labels.map(l => sumMatchingValues(data, lf, l, plan.seriesField!, g, plan.valueField!)),
  }));
  return widget(plan, id, {
    tooltip: { trigger: 'axis' }, legend: { data: groups, top: 0 },
    xAxis: { type: 'category', data: labels }, yAxis: { type: 'value' }, series,
  });
}

function renderLine(plan: WidgetPlan, data: DataRow[], id: string) {
  const x = resolveAxisField(plan);
  if (!x || !plan.valueField) return null;
  const sorted = sortLineData(data, x);
  return widget(plan, id, {
    tooltip: { trigger: 'axis' },
    xAxis:   { type: 'category', data: sorted.map(r => str(r[x])) },
    yAxis:   { type: 'value' },
    series:  [{ type: 'line', data: sorted.map(r => num(r[plan.valueField!])), smooth: true,
                ...(plan.type === 'area_chart' ? { areaStyle: {} } : {}) }],
  });
}

function renderMultiLine(plan: WidgetPlan, data: DataRow[], id: string) {
  const xf = resolveAxisField(plan);
  if (!xf || !plan.valueField || !plan.seriesField) return null;
  const sorted  = sortLineData(data, xf);
  const xValues = uniqueStrings(sorted, xf);
  const groups  = uniqueStrings(sorted, plan.seriesField);
  const series  = groups.map(g => ({
    name: g, type: 'line', smooth: true,
    data: xValues.map(xv => findSeriesPoint(sorted, xf, xv, plan.seriesField!, g, plan.valueField!)),
  }));
  return widget(plan, id, {
    tooltip: { trigger: 'axis' }, legend: { data: groups, top: 0 },
    xAxis: { type: 'category', data: xValues }, yAxis: { type: 'value' }, series,
  });
}

function renderDonut(plan: WidgetPlan, data: DataRow[], id: string) {
  const series = buildCategoricalSeries(plan, data);
  if (!series.length) return null;
  return widget(plan, id, {
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend:  { orient: 'vertical', left: 'left' },
    series:  [{ type: 'pie', radius: ['40%', '70%'], data: series.map(i => ({ name: i.label, value: i.value })) }],
  });
}

function renderScatter(plan: WidgetPlan, data: DataRow[], id: string) {
  if (!plan.xField || !plan.yField) return null;
  return widget(plan, id, {
    tooltip: { trigger: 'item', formatter: '{b}' },
    xAxis:   { type: 'value', name: plan.xField },
    yAxis:   { type: 'value', name: plan.yField },
    series:  [{ type: 'scatter', symbolSize: 12,
                data: data.map(r => ({ name: plan.labelField ? str(r[plan.labelField]) : '', value: [num(r[plan.xField!]), num(r[plan.yField!])] })) }],
  });
}

function renderKpi(plan: WidgetPlan, data: DataRow[], id: string) {
  const vf = resolveNumericValueField(data, plan.valueField);
  if (!vf || !data.length) return null;
  return { id, type: 'kpi_card' as const, title: plan.title, insight: plan.insight, value: num(data[0][vf]) };
}

function renderTable(plan: Pick<WidgetPlan, 'type' | 'title' | 'insight' | 'columns'>, rows: DataRow[], id: string) {
  const columns = plan.columns?.length ? plan.columns : Object.keys(rows[0] ?? {});
  return { id, type: 'table' as const, title: plan.title, insight: plan.insight, columns,
           rows: rows.slice(0, 100).map(r => Object.fromEntries(columns.map(c => [c, r[c]]))) };
}

function renderGauge(plan: WidgetPlan, data: DataRow[], id: string) {
  const vf = resolveNumericValueField(data, plan.valueField);
  if (!vf || !data.length) return null;
  return { id, type: 'gauge_chart' as const, title: plan.title, insight: plan.insight,
           option: { series: [{ type: 'gauge', data: [{ value: num(data[0][vf]), name: plan.title }], min: 0, max: 100 }] } };
}

function renderFunnel(plan: WidgetPlan, data: DataRow[], id: string) {
  const series = buildCategoricalSeries(plan, data);
  if (!series.length) return null;
  return widget(plan, id, {
    tooltip: { trigger: 'item', formatter: '{b}: {c}' },
    series:  [{ type: 'funnel', data: series.map(s => ({ name: s.label, value: s.value })) }],
  });
}

function renderRadar(plan: WidgetPlan, data: DataRow[], id: string) {
  const lf = plan.labelField ?? plan.xField;
  if (!lf || !data.length) return null;
  const metrics = plan.columns?.length
    ? plan.columns
    : Object.keys(data[0]).filter(k => typeof data[0][k] === 'number').slice(0, 6);
  if (!metrics.length) return null;
  const entities = data.slice(0, 5).map(r => ({ name: str(r[lf]), value: metrics.map(m => num(r[m])) }));
  return widget(plan, id, {
    tooltip: {}, legend: { data: entities.map(e => e.name) },
    radar:   { indicator: metrics.map(m => ({ name: m })) },
    series:  [{ type: 'radar', data: entities }],
  });
}

function renderHeatmap(plan: WidgetPlan, data: DataRow[], id: string) {
  if (!plan.xField || !plan.yField || !plan.valueField) return null;
  const xVals    = uniqueStrings(data, plan.xField);
  const yVals    = uniqueStrings(data, plan.yField);
  const heatData: [number, number, number][] = data.map(r => [
    xVals.indexOf(str(r[plan.xField!])),
    yVals.indexOf(str(r[plan.yField!])),
    num(r[plan.valueField!]),
  ]);
  const maxVal   = Math.max(...heatData.map(d => d[2]), 1);
  return widget(plan, id, {
    tooltip:   { position: 'top' },
    xAxis:     { type: 'category', data: xVals },
    yAxis:     { type: 'category', data: yVals },
    visualMap: { min: 0, max: maxVal, calculable: true, orient: 'horizontal', left: 'center', bottom: '15%' },
    series:    [{ type: 'heatmap', data: heatData, label: { show: true } }],
  });
}

// config-driven field helpers

function planFieldProps(type: string): string[] {
  const def = CHART_BY_TYPE[type];
  return [...(def?.requiredFields ?? []), ...(def?.optionalPlanFields ?? [])];
}

function getFieldValue(plan: WidgetPlan, prop: string): string | undefined {
  return (plan as unknown as Record<string, unknown>)[prop] as string | undefined;
}

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

// LLM-based widget planning

const MAX_WIDGETS    = Number(process.env.CHART_MAX_WIDGETS ?? 3);
const MAX_TOKENS     = Number(process.env.CHART_MAX_TOKENS  ?? 1000);
const LLM_CHART_TYPES = getLlmChartTypes();

const widgetSchema = z.object({
  type:         z.enum(LLM_CHART_TYPES),
  title:        z.string(),
  insight:      z.string().optional(),
  labelField:   z.string().optional(),
  valueField:   z.string().optional(),
  xField:       z.string().optional(),
  yField:       z.string().optional(),
  seriesField:  z.string().optional(),
  columns:      z.array(z.string()).optional(),
  agg:          z.enum(LLM_CHART_AGGREGATIONS).optional(),
  sortDesc:     z.boolean().optional(),
  topN:         z.number().int().positive().optional(),
  chartOptions: chartOptionsSchema,
});

const dashboardSchema = z.object({
  layout:  z.enum(DASHBOARD_LAYOUTS),
  summary: z.string(),
  widgets: z.array(widgetSchema).min(1).max(MAX_WIDGETS),
});

type LlmWidget    = z.infer<typeof widgetSchema>;
type LlmDashboard = z.infer<typeof dashboardSchema>;

// widget validation

function normalizeFields(w: LlmWidget): LlmWidget {
  const def = CHART_BY_TYPE[w.type];
  if (def?.requiresLabel && !w.labelField && w.xField) return { ...w, labelField: w.xField, xField: undefined };
  return w;
}

function validateWidget(w: LlmWidget, keys: Set<string>, rows: DataRow[]): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const norm = normalizeFields(w);
  const def  = CHART_BY_TYPE[w.type];

  for (const prop of planFieldProps(w.type)) {
    const name = getFieldValue(norm as WidgetPlan, prop);
    if (name && !keys.has(name)) reasons.push(`${prop}="${name}" not in data`);
  }

  const isNumeric = (f: string) =>
    rows.slice(0, 20).some(r => r[f] != null) &&
    rows.slice(0, 20).every(r => r[f] == null || typeof r[f] === 'number');

  if (norm.valueField && keys.has(norm.valueField) && norm.agg !== 'count' && !isNumeric(norm.valueField))
    reasons.push(`valueField "${norm.valueField}" is not numeric`);
  if (def?.requiresAxis && !norm.labelField && !norm.xField)
    reasons.push('no axis field');
  if (def?.requiresSeries && !norm.seriesField)
    reasons.push(`${w.type} requires seriesField`);
  if (def?.requiresXY && (!norm.xField || !norm.yField))
    reasons.push(`${w.type} requires xField and yField`);

  return { ok: reasons.length === 0, reasons };
}

function toWidgetPlan(w: LlmWidget, keys: Set<string>, rows: DataRow[]): WidgetPlan {
  const { agg, ...rest } = normalizeFields(w);
  const def = CHART_BY_TYPE[w.type];

  if (def?.requiresValue && agg !== 'count' && !rest.valueField) {
    const skip = new Set([rest.labelField, rest.xField, rest.seriesField].filter(Boolean) as string[]);
    const detected = [...keys].find(k =>
      !skip.has(k) &&
      rows.slice(0, 5).some(r => r[k] != null) &&
      rows.slice(0, 5).every(r => r[k] == null || typeof r[k] === 'number'),
    );
    if (detected) {
      rest.valueField = detected;
      log('chart:fix', `auto-detected valueField="${detected}" for ${w.type} "${w.title}"`);
    }
  }

  return { ...rest, ...(agg && agg !== 'none' ? { agg: agg as ChartAgg } : {}) } as unknown as WidgetPlan;
}


export async function runChart(
  rows:       Record<string, unknown>[],
  prompt:     string,
  strategy?:  SkillKind,
  chartHint?: ChartHint,
  source?:    DataSource,
  apiKey?:    string,
  model?:     string,
  provider?:  string,
): Promise<DashboardSpec> {
  if (!rows.length) {
    return { layout: 'operational', title: 'No data', summary: 'No rows returned for this request.', widgets: [] };
  }

  log('chart', `rows: ${rows.length} | strategy: ${strategy ?? 'standard'} | hint: ${chartHint ?? '-'} | source: ${source?.name ?? '?'}`);

  const keys = new Set<string>(rows.flatMap(r => Object.keys(r)));

  let plan: LlmDashboard;
  const planStart = Date.now();
  try {
    const { object } = await generateObject({
      model:       resolveModel('chart', apiKey, model, provider),
      abortSignal: freshSignal('chart'),
      temperature: 0,
      maxTokens:   MAX_TOKENS,
      maxRetries:  1,
      schema:      dashboardSchema,
      messages:    [{ role: 'user', content: buildChartPrompt(rows, prompt, strategy, chartHint, source) }],
    });
    plan = object;
    log('chart:llm', `done in ${Date.now() - planStart}ms | proposed: ${plan.widgets.length} widget(s)`);
    logTrace('chart:llm', `widget plan`, plan);
  } catch (err) {
    log('chart', `generateObject failed: ${err instanceof Error ? err.message : err}`);
    return { layout: 'analytical', title: prompt, summary: 'Chart planning failed.', widgets: [] };
  }

  const valid:   WidgetPlan[] = [];
  const dropped: string[]     = [];

  for (const w of plan.widgets.slice(0, MAX_WIDGETS)) {
    const check = validateWidget(w, keys, rows);
    if (check.ok) {
      valid.push(toWidgetPlan(w, keys, rows));
      log('chart:llm', `accepted ${w.type} "${w.title}"`);
    } else {
      dropped.push(`${w.type}: ${check.reasons.join('; ')}`);
      log('chart:llm', `rejected ${w.type} — ${check.reasons.join('; ')}`);
    }
  }

  const widgets = valid
    .map((w, i) => renderWidget(w, rows, keys, `w${i + 1}`))
    .filter((w): w is NonNullable<typeof w> => w !== null);

  const dashboard = { layout: plan.layout, title: prompt, summary: plan.summary, widgets } as DashboardSpec;
  log('chart', `done | widgets: ${widgets.length}${dropped.length ? ` | dropped: ${dropped.length}` : ''} | layout: ${plan.layout}`);

  void chartRepo.save({ prompt, sourceName: source?.name ?? '', dashboard });
  return dashboard;
}
