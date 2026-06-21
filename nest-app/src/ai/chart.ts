import { generateObject }             from 'ai';
import { z }                           from 'zod';
import { log, logTrace }               from '../common/logger/app.logger';
import { resolveModel, freshSignal }   from './model';
import { readJsonSection, skillFile }  from './skill-prompt';
import { buildChartPrompt }            from '../prompts/chart.prompt';
import type { DashboardSpec, SkillKind, ChartHint, DataSource } from '../types';


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

const configService= readJsonSection<SkillConfig>(skillFile('chart', 'SKILL.md'), 'Chart Config');
export const CHART_DEFINITIONS: readonly ChartDefinition[] = configService.types;
const CHART_AGGREGATIONS     = configService.aggregations as [string, ...string[]];
const LLM_CHART_AGGREGATIONS = [...CHART_AGGREGATIONS, 'none'] as [string, ...string[]];
const DASHBOARD_LAYOUTS      = configService.layouts as [string, ...string[]];
const CHART_BY_TYPE          = Object.fromEntries(configService.types.map(d => [d.type, d])) as Record<string, ChartDefinition>;

function getLlmChartTypes(): [string, ...string[]] {
  return configService.types.filter(d => !d.llmHidden).map(d => d.type) as [string, ...string[]];
}


const chartOptionsSchema = z.record(z.unknown()).optional();

const widgetSchema = z.object({
  type:         z.enum(getLlmChartTypes()),
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
  widgets: z.array(widgetSchema).min(1),
});

type LlmWidget    = z.infer<typeof widgetSchema>;
type LlmDashboard = z.infer<typeof dashboardSchema>;
type DataRow      = Record<string, unknown>;
type ChartAgg     = typeof CHART_AGGREGATIONS[number];
type FieldKind    = 'numeric' | 'temporal' | 'categorical' | 'complex';

interface RowProfile {
  all:         string[];
  numeric:     string[];
  temporal:    string[];
  categorical: string[];
}

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

type Renderer = (plan: WidgetPlan, data: DataRow[], id: string) => unknown;


const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0);
const GENERIC_LABEL_TOKENS = new Set(['label', 'name', 'title', 'category', 'group', 'segment', 'region', 'type']);
const GENERIC_VALUE_TOKENS = new Set(['value', 'total', 'amount', 'metric', 'budget', 'count', 'sum', 'score']);
const GENERIC_TIME_TOKENS  = new Set(['date', 'time', 'month', 'year', 'day', 'week', 'period']);
const DISPLAY_OBJECT_KEYS  = ['label', 'name', 'title', 'value', 'text', 'region', 'category', 'type', 'code', 'id'];

function normalizeFieldToken(value?: string) {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toDisplayLabel(value: unknown, depth = 0): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || value instanceof Date) return String(value);
  if (Array.isArray(value)) {
    if (depth >= 2) return value.map(v => String(v)).join(', ');
    return value.map(v => toDisplayLabel(v, depth + 1)).filter(Boolean).join(', ');
  }
  if (isPlainObject(value)) {
    for (const key of DISPLAY_OBJECT_KEYS) {
      const nested = value[key];
      const label = toDisplayLabel(nested, depth + 1);
      if (label) return label;
    }
    if (depth >= 2) return JSON.stringify(value);
    const nested = Object.values(value)
      .map(v => toDisplayLabel(v, depth + 1))
      .filter(Boolean);
    return nested[0] ?? JSON.stringify(value);
  }
  return String(value);
}

const str = (v: unknown): string => toDisplayLabel(v);

function isNumericLike(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') {
    const trimmed = value.trim().replace(/,/g, '');
    return trimmed.length > 0 && Number.isFinite(Number(trimmed));
  }
  return false;
}

function isTemporalLike(value: unknown) {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && !Number.isNaN(Date.parse(trimmed));
}

function fieldSamples(rows: DataRow[], field: string) {
  return rows.map(r => r[field]).filter(v => v != null).slice(0, 20);
}

function classifyField(rows: DataRow[], field: string): FieldKind {
  const samples = fieldSamples(rows, field);
  if (!samples.length) return 'categorical';
  if (samples.some(sample => Array.isArray(sample) || isPlainObject(sample))) return 'complex';
  if (samples.every(isNumericLike))  return 'numeric';
  if (samples.every(isTemporalLike)) return 'temporal';
  return 'categorical';
}

function buildRowProfile(keys: Set<string>, rows: DataRow[]): RowProfile {
  const all         = [...keys];
  const numeric: string[]     = [];
  const temporal: string[]    = [];
  const categorical: string[] = [];

  for (const field of all) {
    const kind = classifyField(rows, field);
    if (kind === 'numeric') numeric.push(field);
    else if (kind === 'temporal') temporal.push(field);
    else if (kind === 'categorical') categorical.push(field);
  }

  return { all, numeric, temporal, categorical };
}

function pickFields(profile: RowProfile, kinds: FieldKind[], exclude: string[] = [], limit = 1) {
  const blocked = new Set(exclude.filter(Boolean));
  const picked: string[] = [];

  for (const kind of kinds) {
    const bucket = profile[kind];
    for (const field of bucket) {
      if (blocked.has(field)) continue;
      picked.push(field);
      blocked.add(field);
      if (picked.length >= limit) return picked;
    }
  }

  return picked;
}

function scoreFieldCandidate(requested: string, candidate: string) {
  const wanted    = normalizeFieldToken(requested);
  const current   = normalizeFieldToken(candidate);
  const rawWanted = requested.trim().toLowerCase();
  const rawNow    = candidate.trim().toLowerCase();

  if (!wanted) return 0;
  if (requested === candidate) return 100;
  if (rawWanted === rawNow) return 90;
  if (wanted === current) return 80;
  if (current.includes(wanted) || wanted.includes(current)) return 55;
  return 0;
}

function defaultKindsForToken(token: string): FieldKind[] {
  if (GENERIC_TIME_TOKENS.has(token))  return ['temporal', 'categorical'];
  if (GENERIC_VALUE_TOKENS.has(token)) return ['numeric'];
  if (GENERIC_LABEL_TOKENS.has(token)) return ['categorical', 'temporal'];
  return [];
}

function resolveFieldName(
  requested: string | undefined,
  profile:   RowProfile,
  preferred: FieldKind[],
  exclude:   string[] = [],
) {
  const blocked = new Set(exclude.filter(Boolean));
  const token   = normalizeFieldToken(requested);
  const scoped  = preferred.length ? pickFields(profile, preferred, exclude, profile.all.length) : profile.all.filter(f => !blocked.has(f));
  const pool    = scoped.length ? scoped : profile.all.filter(f => !blocked.has(f));

  if (requested && !blocked.has(requested) && profile.all.includes(requested)) return requested;

  if (requested) {
    const scored = pool
      .map(field => ({ field, score: scoreFieldCandidate(requested, field) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);
    if (scored[0]) return scored[0].field;
  }

  const genericKinds = token ? defaultKindsForToken(token) : [];
  const picked = pickFields(profile, genericKinds.length ? genericKinds : preferred, exclude, 1);
  return picked[0];
}

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

function mergeChartOptions(rendered: unknown, chartOptions: WidgetPlan['chartOptions']) {
  if (!rendered || !chartOptions) return rendered;
  const result = rendered as Record<string, unknown>;
  if (typeof result.option === 'object' && result.option !== null) {
    return { ...result, option: deepMerge(result.option as Record<string, unknown>, chartOptions) };
  }
  return rendered;
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
  if (plan.sortDesc && plan.valueField && !plan.agg) {
    data.sort((a, b) => num(b[plan.valueField!]) - num(a[plan.valueField!]));
  }
  if (plan.topN && !plan.agg) return data.slice(0, plan.topN);
  return data;
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

function patchPlanField(plan: WidgetPlan, field: keyof WidgetPlan, value: string | undefined) {
  if (!value) return;
  if (plan[field] !== value) {
    log('chart:fix', `mapped ${String(field)}="${String(plan[field] ?? '-')}" → "${value}" for ${plan.type} "${plan.title}"`);
    (plan as unknown as Record<string, unknown>)[field] = value;
  }
}

function repairColumns(plan: WidgetPlan, profile: RowProfile) {
  if (plan.type === 'radar_chart') {
    const valid = (plan.columns ?? []).filter(col => profile.numeric.includes(col));
    plan.columns = valid.length ? valid : pickFields(profile, ['numeric'], [plan.labelField ?? ''], 6);
  } else if (plan.type === 'table') {
    const valid = (plan.columns ?? []).filter(col => profile.all.includes(col));
    plan.columns = valid.length ? valid : profile.all.slice(0, 6);
  }
}

function repairWidgetPlan(raw: LlmWidget, profile: RowProfile, rows: DataRow[]): WidgetPlan {
  const { agg, ...rest } = normalizeFields(raw);
  const plan = { ...rest, ...(agg && agg !== 'none' ? { agg: agg as ChartAgg } : {}) } as WidgetPlan;

  switch (plan.type) {
    case 'line_chart':
    case 'area_chart':
      patchPlanField(plan, 'xField', resolveFieldName(plan.xField, profile, ['temporal', 'categorical'], [plan.valueField ?? '', plan.seriesField ?? '']));
      patchPlanField(plan, 'valueField', resolveFieldName(plan.valueField, profile, ['numeric'], [plan.xField ?? '', plan.seriesField ?? '']));
      break;
    case 'multi_line_chart':
      patchPlanField(plan, 'xField', resolveFieldName(plan.xField, profile, ['temporal', 'categorical'], [plan.seriesField ?? '', plan.valueField ?? '']));
      patchPlanField(plan, 'seriesField', resolveFieldName(plan.seriesField, profile, ['categorical'], [plan.xField ?? '', plan.valueField ?? '']));
      patchPlanField(plan, 'valueField', resolveFieldName(plan.valueField, profile, ['numeric'], [plan.xField ?? '', plan.seriesField ?? '']));
      break;
    case 'scatter_plot': {
      const numeric = pickFields(profile, ['numeric'], [plan.labelField ?? ''], 2);
      patchPlanField(plan, 'xField', resolveFieldName(plan.xField, profile, ['numeric'], [plan.yField ?? '', plan.labelField ?? '']) ?? numeric[0]);
      patchPlanField(plan, 'yField', resolveFieldName(plan.yField, profile, ['numeric'], [plan.xField ?? '', plan.labelField ?? '']) ?? numeric[1]);
      patchPlanField(plan, 'labelField', resolveFieldName(plan.labelField, profile, ['categorical'], [plan.xField ?? '', plan.yField ?? '']));
      break;
    }
    case 'heatmap':
      patchPlanField(plan, 'xField', resolveFieldName(plan.xField, profile, ['categorical', 'temporal'], [plan.yField ?? '', plan.valueField ?? '']));
      patchPlanField(plan, 'yField', resolveFieldName(plan.yField, profile, ['categorical', 'temporal'], [plan.xField ?? '', plan.valueField ?? '']));
      patchPlanField(plan, 'valueField', resolveFieldName(plan.valueField, profile, ['numeric'], [plan.xField ?? '', plan.yField ?? '']));
      break;
    case 'grouped_bar_chart':
    case 'stacked_bar_chart':
      patchPlanField(plan, 'labelField', resolveFieldName(plan.labelField ?? plan.xField, profile, ['categorical', 'temporal'], [plan.seriesField ?? '', plan.valueField ?? '']));
      patchPlanField(plan, 'seriesField', resolveFieldName(plan.seriesField, profile, ['categorical'], [plan.labelField ?? '', plan.valueField ?? '']));
      patchPlanField(plan, 'valueField', resolveFieldName(plan.valueField, profile, ['numeric'], [plan.labelField ?? '', plan.seriesField ?? '']));
      plan.xField = undefined;
      break;
    case 'radar_chart':
      patchPlanField(plan, 'labelField', resolveFieldName(plan.labelField ?? plan.xField, profile, ['categorical'], []));
      repairColumns(plan, profile);
      break;
    case 'table':
      repairColumns(plan, profile);
      break;
    case 'kpi_card':
    case 'gauge_chart':
      patchPlanField(plan, 'valueField', resolveFieldName(plan.valueField, profile, ['numeric'], []));
      break;
    default:
      patchPlanField(plan, 'labelField', resolveFieldName(plan.labelField ?? plan.xField, profile, ['categorical', 'temporal'], [plan.valueField ?? '']));
      patchPlanField(plan, 'valueField', resolveFieldName(plan.valueField, profile, ['numeric'], [plan.labelField ?? '']));
      plan.xField = undefined;
      break;
  }

  if (CHART_BY_TYPE[plan.type]?.requiresValue && plan.agg !== 'count' && !plan.valueField) {
    patchPlanField(plan, 'valueField', pickFields(profile, ['numeric'], [plan.labelField ?? '', plan.xField ?? '', plan.seriesField ?? '', plan.yField ?? ''], 1)[0]);
  }

  if (plan.type === 'table') {
    repairColumns(plan, profile);
  }

  return plan;
}

function synthesizeWidgets(
  profile:   RowProfile,
  rows:      DataRow[],
  strategy?: SkillKind,
  chartHint?: ChartHint,
): WidgetPlan[] {
  const hint     = chartHint?.toLowerCase() ?? '';
  const planMode = strategy?.toLowerCase() ?? '';

  if ((hint === 'scatter' || planMode === 'anomaly') && profile.numeric.length >= 2) {
    return [{
      type:      'scatter_plot',
      title:     'Scatter View',
      xField:    profile.numeric[0],
      yField:    profile.numeric[1],
      labelField: profile.categorical[0],
    }];
  }

  if ((hint === 'trend' || planMode === 'trend') && profile.temporal.length && profile.numeric.length) {
    return [{
      type:       'line_chart',
      title:      'Trend',
      xField:     profile.temporal[0],
      valueField: profile.numeric[0],
    }];
  }

  if ((hint === 'heatmap' || (planMode === 'comparison' && profile.categorical.length >= 2)) && profile.categorical.length >= 2 && profile.numeric.length) {
    return [{
      type:       'heatmap',
      title:      'Cross Breakdown',
      xField:     profile.categorical[0],
      yField:     profile.categorical[1],
      valueField: profile.numeric[0],
    }];
  }

  if (profile.categorical.length && profile.numeric.length) {
    const lowCardinality = uniqueStrings(rows, profile.categorical[0]).length <= 6;
    const chartType = hint === 'part_of_whole' && lowCardinality ? 'donut_chart' : 'horizontal_bar_chart';
    return [{
      type:       chartType,
      title:      'Breakdown',
      labelField: profile.categorical[0],
      valueField: profile.numeric[0],
      ...(chartType === 'horizontal_bar_chart' ? { sortDesc: true } : {}),
    }];
  }

  if (profile.numeric.length) {
    return [{
      type:       'kpi_card',
      title:      'Key Metric',
      valueField: profile.numeric[0],
    }];
  }

  return [{
    type:    'table',
    title:   'Data View',
    columns: profile.all.slice(0, 6),
  }];
}

const widget = (plan: WidgetPlan, id: string, option: Record<string, unknown>) =>
  ({ id, type: plan.type, title: plan.title, insight: plan.insight, option });

// ── Renderers ─────────────────────────────────────────────────────────────────

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
  const labels = uniqueStrings(data, lf);
  const groups = uniqueStrings(data, plan.seriesField);
  const series = groups.map(g => ({
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
                data: data.map(r => ({
                  name:  plan.labelField ? str(r[plan.labelField]) : '',
                  value: [num(r[plan.xField!]), num(r[plan.yField!])],
                })) }],
  });
}

function renderKpi(plan: WidgetPlan, data: DataRow[], id: string) {
  const vf = resolveNumericValueField(data, plan.valueField);
  if (!vf || !data.length) return null;
  return { id, type: 'kpi_card' as const, title: plan.title, insight: plan.insight, value: num(data[0][vf]) };
}

function renderGauge(plan: WidgetPlan, data: DataRow[], id: string) {
  const vf = resolveNumericValueField(data, plan.valueField);
  if (!vf || !data.length) return null;
  const value = num(data[0][vf]);
  return widget(plan, id, {
    series: [{ type: 'gauge', data: [{ value, name: plan.title }], min: 0, max: 100 }],
  });
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
  const maxVal = Math.max(...heatData.map(d => d[2]), 1);
  return widget(plan, id, {
    tooltip:   { position: 'top' },
    xAxis:     { type: 'category', data: xVals },
    yAxis:     { type: 'category', data: yVals },
    visualMap: { min: 0, max: maxVal, calculable: true, orient: 'horizontal', left: 'center', bottom: '15%' },
    series:    [{ type: 'heatmap', data: heatData, label: { show: true } }],
  });
}

function renderTable(plan: Pick<WidgetPlan, 'type' | 'title' | 'insight' | 'columns'>, rows: DataRow[], id: string) {
  const columns = plan.columns?.length ? plan.columns : Object.keys(rows[0] ?? {});
  return {
    id, type: 'table' as const, title: plan.title, insight: plan.insight, columns,
    rows: rows.slice(0, 100).map(r => Object.fromEntries(columns.map(c => [c, r[c]]))),
  };
}

// custom: LLM puts a full ECharts option in chartOptions; renderer returns empty base
// so mergeChartOptions(base={option:{}}, chartOptions) → {option: chartOptions}
function renderCustom(plan: WidgetPlan, _data: DataRow[], id: string) {
  return { id, type: 'custom' as const, title: plan.title, insight: plan.insight, option: {} };
}

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
  custom:                renderCustom,
};

// ── Validation & plan resolution ──────────────────────────────────────────────

function planFieldProps(type: string): string[] {
  const def = CHART_BY_TYPE[type];
  return [...(def?.requiredFields ?? []), ...(def?.optionalPlanFields ?? [])];
}

function getFieldValue(plan: WidgetPlan, prop: string): string | undefined {
  return (plan as unknown as Record<string, unknown>)[prop] as string | undefined;
}

function normalizeFields(w: LlmWidget): LlmWidget {
  const def = CHART_BY_TYPE[w.type];
  if (def?.requiresLabel && !w.labelField && w.xField) return { ...w, labelField: w.xField, xField: undefined };
  return w;
}

function validateWidget(w: WidgetPlan, profile: RowProfile, rows: DataRow[]): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const def  = CHART_BY_TYPE[w.type];

  if (w.type === 'custom') return { ok: true, reasons };

  for (const prop of planFieldProps(w.type)) {
    const name = getFieldValue(w, prop);
    if (name && !profile.all.includes(name)) reasons.push(`${prop}="${name}" not in data`);
  }

  const isNumeric = (f: string) =>
    rows.slice(0, 20).some(r => r[f] != null) &&
    rows.slice(0, 20).every(r => r[f] == null || isNumericLike(r[f]));

  if (w.valueField && profile.all.includes(w.valueField) && w.agg !== 'count' && !isNumeric(w.valueField))
    reasons.push(`valueField "${w.valueField}" is not numeric-like`);
  if (def?.requiresAxis && !w.labelField && !w.xField)
    reasons.push('no axis field');
  if (def?.requiresSeries && !w.seriesField) reasons.push(`${w.type} requires seriesField`);
  if (def?.requiresXY && (!w.xField || !w.yField)) reasons.push(`${w.type} requires xField and yField`);

  return { ok: reasons.length === 0, reasons };
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

  const keys = new Set<string>(rows.flatMap(r => Object.keys(r)));
  const profile = buildRowProfile(keys, rows);

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
    logTrace('chart:llm', `widget plan`, plan);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log('chart', `generateObject failed: ${msg}`);
    throw err;
  }

  const valid:   WidgetPlan[] = [];
  const dropped: string[]     = [];

  for (const w of plan.widgets.slice(0, MAX_WIDGETS)) {
    const repaired = repairWidgetPlan(w, profile, rows);
    const check = validateWidget(repaired, profile, rows);
    if (check.ok) {
      valid.push(repaired);
      log('chart:llm', `accepted ${w.type} "${w.title}"`);
    } else {
      dropped.push(`${w.type}: ${check.reasons.join('; ')}`);
      log('chart:llm', `rejected ${w.type} — ${check.reasons.join('; ')}`);
    }
  }

  let widgets = valid
    .map((w, i) => renderWidget(w, rows, keys, `w${i + 1}`))
    .filter((w): w is NonNullable<typeof w> => w !== null);

  if (!widgets.length) {
    const adaptivePlans = synthesizeWidgets(profile, rows, strategy, chartHint)
      .slice(0, MAX_WIDGETS)
      .map(plan => repairWidgetPlan(plan as unknown as LlmWidget, profile, rows));

    widgets = adaptivePlans
      .map((w, i) => renderWidget(w, rows, keys, `auto${i + 1}`))
      .filter((w): w is NonNullable<typeof w> => w !== null);

    if (widgets.length) {
      log('chart:auto', `synthesized ${widgets.length} widget(s) from row profile`);
    }
  }

  log('chart', `done | widgets: ${widgets.length}${dropped.length ? ` | dropped: ${dropped.length}` : ''} | layout: ${plan.layout}`);

  return { layout: plan.layout, title: prompt, summary: plan.summary, widgets } as DashboardSpec;
}
