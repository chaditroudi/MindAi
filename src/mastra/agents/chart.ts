import { Agent } from '@mastra/core/agent';
import { generateObject } from 'ai';
import { z } from 'zod';
import { resolveModel } from '../model.js';

import { chartPlanSchema, chartResultSchema, chartTypeSchema } from '../schemas/chart.js';
import type { ChartPlan } from '../schemas/chart.js';
import { datasetSchema } from '../schemas/intent.js';
import { envTimeout, withTimeout } from '../../utils/timeout.js';

const BASE_INSTRUCTIONS = `
You are the Chart Planner for the Mind Platform analytics service.

You receive the exact output of a MongoDB aggregation pipeline and decide how
to visualize it. Read the data shape from datasetSchema and sampleRows, then
return the chart configuration. You are the sole decision maker.

INPUT (JSON)
  datasetSchema   — exact fields the MongoDB pipeline returned:
                    { fieldName: "string"|"number"|"integer"|"boolean"|"date"|"datetime"|"geo" }
  sampleRows      — up to 3 real rows from the pipeline (context only — never echo values)
  rowCount        — total rows the pipeline returned
  supervisorHints — { intentHint, suggestedXAxis, suggestedYAxis, suggestedGroupBy }
                    Use as strong hints. Override only when data shape contradicts them.
  userPrompt      — the original user request
  candidateTypes  — chart types valid for this data shape

OUTPUT (JSON only — no markdown, no prose, no code fences)
  {
    "chartType":    one value from candidateTypes,
    "xAxisField":   field name from datasetSchema,
    "yAxisField":   field name from datasetSchema (must be numeric or integer),
    "groupByField": field name for series clustering — omit when not applicable,
    "title":        concise chart title in the same language as userPrompt
  }

═══════════════════════════════════════════════════════
DATA SHAPE → CHART CONFIG
Read the schema. Match the shape. Output the config.
═══════════════════════════════════════════════════════

SHAPE 1 — temporal + numeric
  Schema has one date/datetime field and one numeric field.
  Example: { createdAt: "date", value: "integer" }
  → chartType: line
  → xAxisField: the temporal field
  → yAxisField: the numeric field
  → groupByField: omit

SHAPE 2 — temporal + string + numeric  (multi-series time)
  Schema has one date/datetime, one string/boolean, one numeric.
  Example: { createdAt: "date", municipality: "string", value: "integer" }
  → chartType: line
  → xAxisField: the temporal field
  → yAxisField: the numeric field
  → groupByField: the string field (each value becomes its own line)

SHAPE 3 — string + numeric  (simple aggregation)
  Schema has one string/boolean field and one numeric field.
  Example: { municipality: "string", value: "integer" }
  → rowCount ≤ 12: chartType: donut
  → rowCount > 12: chartType: horizontalBar
  → xAxisField: the string field
  → yAxisField: the numeric field
  → groupByField: omit

SHAPE 4 — string + string + numeric  (grouped / clustered)
  Schema has two string/boolean fields and one numeric field.
  Example: { municipality: "string", status: "string", value: "integer" }
  → chartType: bar  (clustered — each status becomes a series)
  → xAxisField: the primary string field (the main category, e.g. municipality)
  → yAxisField: the numeric field
  → groupByField: the secondary string field (e.g. status)

SHAPE 5 — two or more numerics, no temporal  (correlation)
  Schema has two or more numeric/integer fields and no temporal field.
  Example: { responseTime: "number", resolutionRate: "number" }
  → chartType: scatter
  → xAxisField: first numeric field
  → yAxisField: second numeric field
  → groupByField: string field if present, else omit

SHAPE 6 — geo + numeric
  Schema has one geo field and one numeric field.
  Example: { region: "geo", value: "integer" }
  → chartType: map
  → xAxisField: the geo field
  → yAxisField: the numeric field
  → groupByField: omit

SHAPE 7 — single numeric, many rows  (distribution)
  Schema has only one numeric field and rowCount > 20.
  Example: { responseTime: "number" }
  → chartType: histogram
  → xAxisField: the numeric field
  → yAxisField: the numeric field
  → groupByField: omit

SHAPE 8 — supervisorHints.intentHint overrides shape detection:
  trend         → use SHAPE 1 or 2 rules (line chart, must have temporal)
  ranking       → horizontalBar  (xAxis = string dim, yAxis = numeric, no groupByField)
  compare       → bar or horizontalBar based on rowCount
  part_of_whole → donut when rowCount ≤ 12, else horizontalBar
  distribution  → histogram (SHAPE 7)
  geo           → map when geo field exists, else horizontalBar

═══════════════════════════════════════════════════════
FIELD SELECTION
═══════════════════════════════════════════════════════

  xAxisField priority: supervisorHints.suggestedXAxis (if valid) >
                       temporal > geo > primary string dimension.

  yAxisField priority: supervisorHints.suggestedYAxis (if numeric) >
                       field named "value", "count", "total", "sum", "avg",
                       "rate", "amount" > any other numeric field.
                       MUST be numeric or integer.

  groupByField: supervisorHints.suggestedGroupBy (if valid and differs from
                xAxisField and yAxisField) > secondary string field per shape rules.
                Only set when the field meaningfully creates separate series.

  Excluded: "_id", "tenantId", fields ending in "Id", fields starting with "__".
  Every field MUST be an exact name from datasetSchema.

═══════════════════════════════════════════════════════
HARD RULES
═══════════════════════════════════════════════════════
  - chartType MUST be one of candidateTypes.
  - Never invent field names.
  - yAxisField must be numeric or integer.
  - Output the JSON object only. No markdown, code fences, or prose.
`;

export const chartPlannerAgent: Agent = new Agent({
  name: 'Chart Planner',
  instructions: BASE_INSTRUCTIONS,
  model: resolveModel('chart'),
});

// ─── Chart Runtime ────────────────────────────────────────────────────────────

type Row = Record<string, string | number | boolean | null>;
type Dataset = z.infer<typeof datasetSchema>;
type ChartType = z.infer<typeof chartTypeSchema>;
type IntentHint = 'compare' | 'trend' | 'distribution' | 'part_of_whole' | 'geo' | 'ranking';

export type ChartRuntimeInput = {
  dataset: Dataset;
  intentHint?: IntentHint;
  title?: string;
  theme?: 'light' | 'dark' | 'brand';
  preferredXAxisField?: string;
  preferredYAxisField?: string;
  preferredGroupByField?: string;
  sizeField?: string;
  stackBars?: boolean;
  bins?: number;
  smooth?: boolean;
  colorPalette?: string[];
  showDataZoom?: boolean;
  yAxisMin?: number;
  yAxisMax?: number;
  labelFormat?: 'number' | 'currency' | 'percent' | 'compact';
};

export async function runChartRuntime({
  dataset, intentHint, title, theme = 'light',
  preferredXAxisField, preferredYAxisField, preferredGroupByField,
  sizeField, stackBars, bins, smooth, colorPalette, showDataZoom, yAxisMin, yAxisMax, labelFormat,
}: ChartRuntimeInput) {
  if (dataset.rows.length === 0) {
    return chartResultSchema.parse(buildChartFromDataset({ dataset, theme, title: title ?? 'No matching data' }));
  }

  let plan: ChartPlan | undefined;
  try {
    plan = await runChartPlanner({ dataset, intentHint, title, preferredXAxisField, preferredYAxisField, preferredGroupByField });
  } catch {
    // LLM returned invalid field names — fall through to auto-detection below
  }

  return chartResultSchema.parse(buildChartFromDataset({
    dataset, intentHint, theme,
    title: plan?.title ?? title,
    chartType: plan?.chartType,
    xAxisField: plan?.xAxisField,
    yAxisField: plan?.yAxisField,
    groupByField: plan?.groupByField,
    sizeField, stackBars, bins, smooth, colorPalette, showDataZoom, yAxisMin, yAxisMax, labelFormat,
  }));
}

async function runChartPlanner({
  dataset, intentHint, title, preferredXAxisField, preferredYAxisField, preferredGroupByField,
}: {
  dataset: Dataset; intentHint?: IntentHint; title?: string;
  preferredXAxisField?: string; preferredYAxisField?: string; preferredGroupByField?: string;
}): Promise<ChartPlan> {
  const candidates     = getChartTypeCandidates(dataset);
  const hidden         = new Set(['_id', 'tenantId']);
  const visible        = Object.keys(dataset.schema).filter((f) => !hidden.has(f) && !f.endsWith('Id') && !f.startsWith('__'));
  const validSet       = new Set(visible);
  const hint           = (f?: string) => (f && visible.includes(f) ? f : null);
  const { object: plan } = await withTimeout(
    generateObject({
      model: resolveModel('chart'), schema: chartPlanSchema, maxTokens: 400, temperature: 0,
      messages: [{ role: 'user', content: JSON.stringify({
        datasetSchema: Object.fromEntries(visible.map((f) => [f, dataset.schema[f]])),
        sampleRows: dataset.rows.slice(0, 3).map((row) => Object.fromEntries(visible.map((f) => [f, row[f]]))),
        rowCount: dataset.rows.length,
        supervisorHints: { intentHint: intentHint ?? null, suggestedXAxis: hint(preferredXAxisField), suggestedYAxis: hint(preferredYAxisField), suggestedGroupBy: hint(preferredGroupByField) },
        userPrompt: title ?? '', candidateTypes: candidates,
      }) }],
    }),
    'chart.planner', envTimeout('CHART_TIMEOUT_MS', 8000),
  );
  if (!plan.chartType || !candidates.includes(plan.chartType)) throw new Error(`Invalid chartType: "${plan.chartType}"`);
  if (!plan.xAxisField || !validSet.has(plan.xAxisField)) throw new Error(`Invalid xAxisField: "${plan.xAxisField}"`);
  if (!plan.yAxisField || !validSet.has(plan.yAxisField)) throw new Error(`Invalid yAxisField: "${plan.yAxisField}"`);
  if (plan.groupByField && !validSet.has(plan.groupByField)) throw new Error(`Invalid groupByField: "${plan.groupByField}"`);
  return { ...plan, groupByField: plan.groupByField ?? undefined, title: plan.title ?? title };
}

// ─── Chart Builder ────────────────────────────────────────────────────────────

type ChartOpts = { stackBars?: boolean; bins?: number; smooth?: boolean; colorPalette?: string[]; showDataZoom?: boolean; yAxisMin?: number; yAxisMax?: number; labelFormat?: 'number' | 'currency' | 'percent' | 'compact'; sizeField?: string; seriesGroupField?: string; };
type BuildChartInput = { dataset: Dataset; intentHint?: IntentHint; chartType?: ChartType; title?: string; theme?: string; xAxisField?: string; yAxisField?: string; groupByField?: string; sizeField?: string; stackBars?: boolean; bins?: number; smooth?: boolean; colorPalette?: string[]; showDataZoom?: boolean; yAxisMin?: number; yAxisMax?: number; labelFormat?: 'number' | 'currency' | 'percent' | 'compact'; };

const VALUE_ALIASES = ['value', 'count', 'total', 'sum', 'average', 'avg', 'amount', 'score', 'rate', 'quantity', 'cnt', 'n'];

function resolveValueField(fields: string[], schema: Record<string, string>) {
  return fields.find((f) => VALUE_ALIASES.includes(f.toLowerCase())) ?? fields.find((f) => schema[f] === 'number' || schema[f] === 'integer');
}

function buildChartFromDataset({ dataset, intentHint, chartType, title, theme = 'light', xAxisField, yAxisField, groupByField, sizeField, stackBars, bins, smooth, colorPalette, showDataZoom, yAxisMin, yAxisMax, labelFormat }: BuildChartInput) {
  const { rows, schema } = dataset;
  if (rows.length === 0) return emptyChart(title ?? 'لا توجد بيانات', theme);
  const fields = Object.keys(schema).filter((f) => !isTechnicalField(f));
  const temporalField = xAxisField && isTemporalField(xAxisField, schema, rows) ? xAxisField : fields.find((f) => isTemporalField(f, schema, rows));
  const geoField = fields.find((f) => schema[f] === 'geo');
  const numericFields = fields.filter((f) => schema[f] === 'number' || schema[f] === 'integer');
  const valueField = yAxisField ?? resolveValueField(fields, schema);
  const dimensionFields = fields.filter((f) => f !== valueField && f !== temporalField && f !== geoField);
  const primaryDim = xAxisField ?? dimensionFields.find((f) => schema[f] === 'string' || schema[f] === 'boolean') ?? dimensionFields[0] ?? fields[0];
  const opts: ChartOpts = { stackBars, bins, smooth, colorPalette, showDataZoom, yAxisMin, yAxisMax, labelFormat, sizeField, seriesGroupField: groupByField };

  if (chartType) { const r = buildRequestedChart({ chartType, rows, temporalField, geoField, numericFields, valueField, dimensionFields, primaryDim, title, theme, opts }); if (r) return r; }
  if (geoField || intentHint === 'geo') { const eg = geoField ?? primaryDim; const val = valueField ?? numericFields.find((f) => f !== eg); if (val && rows.some((r) => typeof r[eg!] === 'number')) return buildMap(rows, eg!, val, title ?? 'حسب الموقع', theme, opts); if (val) return buildBar(rows, eg!, val, title ?? 'حسب المنطقة', theme, true, opts); return emptyChart(title ?? 'لا توجد بيانات رقمية', theme); }
  if (intentHint === 'ranking') { const val = valueField ?? numericFields[0]; if (!primaryDim || !val) return emptyChart(title ?? 'لا توجد بيانات كافية', theme); return buildBar(rows, primaryDim, val, title ?? 'الترتيب', theme, true, opts); }
  if (intentHint === 'compare') { const val = valueField ?? numericFields[0]; if (!primaryDim || !val) return emptyChart(title ?? 'لا توجد بيانات كافية', theme); return buildBar(rows, primaryDim, val, title ?? 'المقارنة', theme, rows.length > 12, opts); }
  if (intentHint === 'trend' || (temporalField && !intentHint)) { const tField = temporalField ?? fields[0]; const val = valueField ?? numericFields[0]; if (!val) return emptyChart(title ?? 'لا توجد بيانات رقمية', theme); const lineDims = opts.seriesGroupField ? [opts.seriesGroupField] : dimensionFields.filter((f) => f !== tField && schema[f] === 'string'); return buildLine(rows, tField, val, lineDims, title ?? 'الاتجاه عبر الزمن', theme, opts); }
  if (intentHint === 'part_of_whole') { const val = valueField ?? numericFields[0]; if (primaryDim && val && rows.length <= 12) return buildDonut(rows, primaryDim, val, title ?? 'الحصة', theme, opts); if (primaryDim && val) return buildBar(rows, primaryDim, val, title ?? 'الحصة', theme, true, opts); return emptyChart(title ?? 'لا توجد بيانات كافية', theme); }
  if (intentHint === 'distribution') { const val = valueField ?? numericFields[0]; if (!val) return emptyChart(title ?? 'لا توجد بيانات رقمية للتوزيع', theme); return buildHistogram(rows, val, title ?? 'التوزيع', theme, opts); }
  if (!temporalField && !intentHint && numericFields.length >= 2) { const xf = xAxisField && numericFields.includes(xAxisField) ? xAxisField : numericFields[0]; const yf = yAxisField && numericFields.includes(yAxisField) ? yAxisField : numericFields.find((f) => f !== xf) ?? numericFields[1]; return buildScatter(rows, xf, yf, opts.seriesGroupField ?? dimensionFields[0], title ?? `${yf} vs ${xf}`, theme, opts); }
  const val = valueField ?? numericFields[0];
  if (!primaryDim || !val) return emptyChart(title ?? 'لا توجد بيانات كافية', theme);
  return buildBar(rows, primaryDim, val, title ?? 'المقارنة', theme, rows.length > 12, opts);
}

export function getChartTypeCandidates(dataset: Dataset): ChartType[] {
  const { rows, schema } = dataset;
  if (rows.length === 0) return ['table'];
  const fields = Object.keys(schema).filter((f) => !isTechnicalField(f));
  const temporalField = fields.find((f) => isTemporalField(f, schema, rows));
  const geoField = fields.find((f) => schema[f] === 'geo');
  const numericFields = fields.filter((f) => schema[f] === 'number' || schema[f] === 'integer');
  const valueField = resolveValueField(fields, schema);
  const dimensionFields = fields.filter((f) => f !== valueField && f !== temporalField && f !== geoField);
  const primaryDim = dimensionFields.find((f) => schema[f] === 'string' || schema[f] === 'boolean') ?? dimensionFields[0] ?? fields[0];
  const c = new Set<ChartType>();
  if (temporalField && valueField) c.add('line');
  if (primaryDim && valueField) { c.add('bar'); c.add('horizontalBar'); if (rows.length <= 12) c.add('donut'); }
  if (valueField) c.add('histogram');
  if (numericFields.length >= 2) c.add('scatter');
  if (geoField && valueField) c.add('map');
  if (c.size === 0) c.add('table');
  return [...c];
}

function buildRequestedChart({ chartType, rows, temporalField, geoField, numericFields, valueField, dimensionFields, primaryDim, title, theme, opts }: { chartType: ChartType; rows: Row[]; temporalField: string | undefined; geoField: string | undefined; numericFields: string[]; valueField: string | undefined; dimensionFields: string[]; primaryDim: string | undefined; title: string | undefined; theme: string; opts: ChartOpts; }) {
  const val = valueField ?? numericFields[0];
  if (chartType === 'line' && temporalField && val) { const lineDims = opts.seriesGroupField ? [opts.seriesGroupField] : dimensionFields.filter((f) => f !== temporalField); return buildLine(rows, temporalField, val, lineDims, title ?? 'الاتجاه عبر الزمن', theme, opts); }
  if (chartType === 'bar' && primaryDim && val) return buildBar(rows, primaryDim, val, title ?? 'المقارنة', theme, false, opts);
  if (chartType === 'horizontalBar' && primaryDim && val) return buildBar(rows, primaryDim, val, title ?? 'المقارنة', theme, true, opts);
  if (chartType === 'donut' && primaryDim && val && rows.length <= 12) return buildDonut(rows, primaryDim, val, title ?? 'الحصة', theme, opts);
  if (chartType === 'histogram' && val) return buildHistogram(rows, val, title ?? 'التوزيع', theme, opts);
  if (chartType === 'scatter' && numericFields.length >= 2) { const xf = numericFields[0]; const yf = numericFields.find((f) => f !== xf) ?? numericFields[1]; return buildScatter(rows, xf, yf, opts.seriesGroupField ?? dimensionFields[0], title ?? `${yf} vs ${xf}`, theme, opts); }
  if (chartType === 'map' && geoField && val) return buildMap(rows, geoField, val, title ?? 'حسب الموقع', theme, opts);
  if (chartType === 'table') return emptyChart(title ?? 'جدول البيانات', theme);
  return undefined;
}

const BRAND_COLORS = ['#2563eb', '#7c3aed', '#0891b2', '#059669', '#d97706', '#dc2626'];
const LABEL_FORMATTERS: Record<string, string> = { currency: '{c} ر.س', percent: '{c}%', compact: '{c}', number: '{c}' };

function baseOption(theme: string, opts: ChartOpts = {}) {
  const isDark = theme === 'dark'; const isBrand = theme === 'brand';
  return { backgroundColor: 'transparent', color: opts.colorPalette ?? (isBrand ? BRAND_COLORS : undefined), textStyle: { fontFamily: '"Segoe UI", Tahoma, "Noto Sans Arabic", sans-serif', color: isDark ? '#e5e7eb' : isBrand ? '#1e293b' : '#111827' }, grid: { left: 48, right: 24, top: 48, bottom: 48, containLabel: true }, tooltip: { trigger: 'item', ...(opts.labelFormat && opts.labelFormat !== 'number' ? { valueFormatter: (v: number) => LABEL_FORMATTERS[opts.labelFormat!].replace('{c}', String(v)) } : {}) }, legend: { top: 20 }, ...(opts.showDataZoom ? { dataZoom: [{ type: 'slider', bottom: 8 }, { type: 'inside' }] } : {}) };
}

function buildBar(rows: Row[], dim: string, val: string, title: string, theme: string, horizontal: boolean, opts: ChartOpts = {}) {
  const cats = rows.map((r) => String(r[dim] ?? ''));
  const yAxisOpts = { type: 'value' as const, ...(opts.yAxisMin !== undefined ? { min: opts.yAxisMin } : {}), ...(opts.yAxisMax !== undefined ? { max: opts.yAxisMax } : {}) };
  if (opts.seriesGroupField && rows.some((r) => r[opts.seriesGroupField!] !== undefined)) {
    const groupValues = [...new Set(rows.map((r) => String(r[opts.seriesGroupField!] ?? '')))];
    const catSet = [...new Set(cats)];
    const series = groupValues.map((g) => ({ name: g, type: 'bar' as const, stack: opts.stackBars ? 'total' : undefined, data: catSet.map((c) => { const m = rows.find((r) => String(r[dim] ?? '') === c && String(r[opts.seriesGroupField!] ?? '') === g); return m ? (m[val] ?? null) : null; }) }));
    return { chartType: horizontal ? ('horizontalBar' as const) : ('bar' as const), option: { ...baseOption(theme, opts), title: { text: title, left: 0 }, xAxis: horizontal ? { ...yAxisOpts } : { type: 'category', data: catSet }, yAxis: horizontal ? { type: 'category', data: catSet } : { ...yAxisOpts }, series, tooltip: { trigger: 'axis' } }, title, accessibility: { description: `مخطط أعمدة ${opts.stackBars ? 'متراكم' : 'مجمّع'} لـ ${val} عبر ${catSet.length} من قيم ${dim}.` } };
  }
  return { chartType: horizontal ? ('horizontalBar' as const) : ('bar' as const), option: { ...baseOption(theme, opts), title: { text: title, left: 0 }, xAxis: horizontal ? { ...yAxisOpts } : { type: 'category', data: cats }, yAxis: horizontal ? { type: 'category', data: cats } : { ...yAxisOpts }, series: [{ type: 'bar', data: rows.map((r) => r[val] ?? null), name: val }], tooltip: { trigger: 'axis' } }, title, accessibility: { description: `مخطط أعمدة يقارن ${val} عبر ${cats.length} من قيم ${dim}.` } };
}

function buildLine(rows: Row[], tField: string, val: string, seriesDims: string[], title: string, theme: string, opts: ChartOpts = {}) {
  const isSmooth = opts.smooth !== false;
  const yAxisOpts = { type: 'value' as const, ...(opts.yAxisMin !== undefined ? { min: opts.yAxisMin } : {}), ...(opts.yAxisMax !== undefined ? { max: opts.yAxisMax } : {}) };
  function sortTimes(times: Set<string>) { return [...times].sort((a, b) => { const da = Date.parse(a); const db = Date.parse(b); return Number.isNaN(da) || Number.isNaN(db) ? a.localeCompare(b) : da - db; }); }
  if (seriesDims.length > 0) {
    const sk = seriesDims[0]; const groups = new Map<string, Map<string, number>>(); const times = new Set<string>();
    for (const r of rows) { const t = String(r[tField] ?? ''); times.add(t); const s = String(r[sk] ?? ''); if (!groups.has(s)) groups.set(s, new Map()); groups.get(s)!.set(t, Number(r[val])); }
    const st = sortTimes(times); const series = [...groups.entries()].map(([name, m]) => ({ name, type: 'line', smooth: isSmooth, data: st.map((t) => m.get(t) ?? null) }));
    return { chartType: 'line' as const, option: { ...baseOption(theme, opts), title: { text: title, left: 0 }, xAxis: { type: 'category', data: st }, yAxis: yAxisOpts, series, tooltip: { trigger: 'axis' } }, title, accessibility: { description: `مخطط خطي لـ ${val} عبر الزمن، بعدد ${series.length} سلاسل.` } };
  }
  const times = new Set(rows.map((r) => String(r[tField] ?? ''))); const st = sortTimes(times); const tv = new Map(rows.map((r) => [String(r[tField] ?? ''), r[val] ?? null]));
  return { chartType: 'line' as const, option: { ...baseOption(theme, opts), title: { text: title, left: 0 }, xAxis: { type: 'category', data: st }, yAxis: yAxisOpts, series: [{ type: 'line', smooth: isSmooth, data: st.map((t) => tv.get(t) ?? null) }], tooltip: { trigger: 'axis' } }, title, accessibility: { description: `مخطط خطي لـ ${val} عبر ${st.length} نقاط زمنية.` } };
}

function buildDonut(rows: Row[], dim: string, val: string, title: string, theme: string, opts: ChartOpts = {}) {
  return { chartType: 'donut' as const, option: { ...baseOption(theme, opts), title: { text: title, left: 0 }, series: [{ type: 'pie', radius: ['40%', '70%'], data: rows.map((r) => ({ name: String(r[dim] ?? ''), value: r[val] ?? null })) }] }, title, accessibility: { description: `مخطط دائري حلقي يوضح ${rows.length} فئات من ${dim}.` } };
}

function buildHistogram(rows: Row[], val: string, title: string, theme: string, opts: ChartOpts = {}) {
  const values = rows.map((r) => Number(r[val])).filter((v) => !Number.isNaN(v));
  if (values.length === 0) return emptyChart(title, theme);
  const mn = Math.min(...values); const mx = Math.max(...values); const bc = opts.bins ?? 10; const w = (mx - mn) / bc || 1;
  const buckets = new Array(bc).fill(0); for (const v of values) { buckets[Math.min(bc - 1, Math.floor((v - mn) / w))]++; }
  return { chartType: 'histogram' as const, option: { ...baseOption(theme, opts), title: { text: title, left: 0 }, xAxis: { type: 'category', data: Array.from({ length: bc }, (_, i) => `${(mn + i * w).toFixed(1)}–${(mn + (i + 1) * w).toFixed(1)}`) }, yAxis: { type: 'value' }, series: [{ type: 'bar', data: buckets, name: 'التكرار', barCategoryGap: '0%' }], tooltip: { trigger: 'axis' } }, title, accessibility: { description: `مدرج تكراري لـ ${val} عبر ${bc} فواصل.` } };
}

function buildScatter(rows: Row[], xField: string, yField: string, groupField: string | undefined, title: string, theme: string, opts: ChartOpts = {}) {
  const hasSF = opts.sizeField && rows.some((r) => r[opts.sizeField!] !== undefined);
  function mp(r: Row): [number, number] | [number, number, number] { const x = Number(r[xField]); const y = Number(r[yField]); return hasSF ? [x, y, Number(r[opts.sizeField!])] : [x, y]; }
  const ss = hasSF ? (v: number[]) => Math.sqrt(v[2]) * 3 : 10;
  if (groupField) {
    const groups = new Map<string, Array<[number, number] | [number, number, number]>>();
    for (const r of rows) { const x = Number(r[xField]); const y = Number(r[yField]); if (Number.isNaN(x) || Number.isNaN(y)) continue; const k = String(r[groupField] ?? 'unspecified'); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(mp(r)); }
    const series = [...groups.entries()].map(([name, data]) => ({ name, type: 'scatter', data, symbolSize: ss }));
    return { chartType: 'scatter' as const, option: { ...baseOption(theme, opts), title: { text: title, left: 0 }, xAxis: { type: 'value', name: xField, scale: true }, yAxis: { type: 'value', name: yField, scale: true }, series, tooltip: { trigger: 'item' } }, title, accessibility: { description: `مخطط مبعثر لـ ${yField} مقابل ${xField} عبر ${series.length} مجموعات.` } };
  }
  const data: Array<[number, number] | [number, number, number]> = [];
  for (const r of rows) { const x = Number(r[xField]); const y = Number(r[yField]); if (!Number.isNaN(x) && !Number.isNaN(y)) data.push(mp(r)); }
  return { chartType: 'scatter' as const, option: { ...baseOption(theme, opts), title: { text: title, left: 0 }, xAxis: { type: 'value', name: xField, scale: true }, yAxis: { type: 'value', name: yField, scale: true }, series: [{ type: 'scatter', data, symbolSize: ss }], tooltip: { trigger: 'item' } }, title, accessibility: { description: `مخطط مبعثر لـ ${yField} مقابل ${xField} عبر ${data.length} نقاط.` } };
}

function buildMap(rows: Row[], geoField: string, val: string, title: string, theme: string, opts: ChartOpts = {}) {
  return { chartType: 'map' as const, option: { ...baseOption(theme, opts), title: { text: title, left: 0 }, visualMap: { min: opts.yAxisMin ?? 0, max: opts.yAxisMax ?? Math.max(...rows.map((r) => Number(r[val]) || 0)) }, series: [{ type: 'map', map: 'world', data: rows.map((r) => ({ name: r[geoField], value: r[val] })) }] }, title, accessibility: { description: `خريطة تدرج لوني لـ ${val} حسب ${geoField}.` } };
}

function emptyChart(title: string, theme = 'light') {
  return { chartType: 'table' as const, option: { ...baseOption(theme), title: { text: title, left: 0 }, graphic: { type: 'text', left: 'center', top: 'middle', style: { text: 'لا توجد بيانات مطابقة للفلاتر الحالية', fill: '#64748b', fontSize: 16, fontWeight: 600, textAlign: 'center' } }, xAxis: { show: false }, yAxis: { show: false }, series: [] }, title, annotations: ['No matching records found for the current filters.'], accessibility: { description: 'لا توجد بيانات متاحة.' } };
}

function isTechnicalField(f: string) { return f === '_id' || f === 'tenantId' || f.endsWith('Id') || f.startsWith('__'); }

function isTemporalField(field: string, schema: Record<string, string>, rows: Row[]) {
  if (schema[field] === 'date' || schema[field] === 'datetime') return true;
  if (/(date|time|created|updated|day|month|year|يوم|تاريخ|شهر|سنة)/i.test(field)) return rows.some((r) => { const v = r[field]; return typeof v === 'string' && !Number.isNaN(Date.parse(v)); });
  return false;
}
