import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { datasetSchema } from '../schemas/intent.js';
import { chartResultSchema, chartTypeSchema } from '../schemas/chart.js';

type Row = Record<string, string | number | boolean | null>;
type ChartType = z.infer<typeof chartTypeSchema>;

type BuildChartInput = {
  dataset: z.infer<typeof datasetSchema>;
  intentHint?: 'compare' | 'trend' | 'distribution' | 'part_of_whole' | 'geo' | 'ranking';
  chartType?: ChartType;
  title?: string;
  theme?: 'light' | 'dark' | 'brand';
};

// Common aggregation output field names, ordered by priority
const VALUE_ALIASES = ['value', 'count', 'total', 'sum', 'average', 'avg', 'amount', 'score', 'rate', 'quantity', 'cnt', 'n'];

export const buildEChartsTool = createTool({
  id: 'build-echarts',
  description:
    'Choose the best chart type for the given dataset and return a complete ECharts option object, plus accessibility text.',
  inputSchema: z.object({
    dataset: datasetSchema,
    intentHint: z.enum(['compare', 'trend', 'distribution', 'part_of_whole', 'geo', 'ranking']).optional(),
    chartType: chartTypeSchema.optional(),
    title: z.string().optional(),
    theme: z.enum(['light', 'dark', 'brand']).default('light'),
  }),
  outputSchema: chartResultSchema,
  execute: async ({ context }) => buildChartFromDataset(context),
});

function resolveValueField(fields: string[], schema: Record<string, string>): string | undefined {
  return (
    fields.find((f) => VALUE_ALIASES.includes(f.toLowerCase())) ??
    fields.find((f) => schema[f] === 'number' || schema[f] === 'integer')
  );
}

export function buildChartFromDataset({
  dataset,
  intentHint,
  chartType,
  title,
  theme = 'light',
}: BuildChartInput) {
  const { rows, schema } = dataset;

  if (rows.length === 0) return emptyChart(title ?? 'لا توجد بيانات');

  const fields = Object.keys(schema).filter((field) => !isTechnicalField(field));
  const temporalField = fields.find((f) => isTemporalField(f, schema, rows));
  const geoField = fields.find((f) => schema[f] === 'geo');
  const numericFields = fields.filter((f) => schema[f] === 'number' || schema[f] === 'integer');
  const valueField = resolveValueField(fields, schema);
  // Prefer categorical fields as dimensions; fall back to any non-value, non-temporal field
  const dimensionFields = fields.filter(
    (f) => f !== valueField && f !== temporalField && f !== geoField,
  );
  const primaryDim = dimensionFields.find((f) => schema[f] === 'string' || schema[f] === 'boolean')
    ?? dimensionFields[0]
    ?? fields[0];

  if (chartType) {
    const requested = buildRequestedChart({
      chartType,
      rows,
      temporalField,
      geoField,
      numericFields,
      valueField,
      dimensionFields,
      primaryDim,
      title,
      theme,
    });
    if (requested) return requested;
  }

  // ── Geo ──────────────────────────────────────────────────────────────────
  if (geoField || intentHint === 'geo') {
    const effectiveGeoField = geoField ?? primaryDim;
    const hasNumericGeo = rows.some((r) => typeof r[effectiveGeoField] === 'number');
    const val = valueField ?? numericFields.find((f) => f !== effectiveGeoField);
    if (hasNumericGeo && val) {
      return buildMap(rows, effectiveGeoField, val, title ?? 'حسب الموقع', theme);
    }
    // String-label geo (zone names, district names) → horizontal bar is more accurate
    if (val) return buildBar(rows, effectiveGeoField, val, title ?? 'حسب المنطقة', theme, true);
    return emptyChart(title ?? 'لا توجد بيانات رقمية');
  }

  // ── Ranking (topN) → horizontal bar, data already sorted DESC ───────────
  if (intentHint === 'ranking') {
    const val = valueField ?? numericFields[0];
    if (!primaryDim || !val) return emptyChart(title ?? 'لا توجد بيانات كافية');
    return buildBar(rows, primaryDim, val, title ?? 'الترتيب', theme, true);
  }

  // ── Explicit compare → bar ────────────────────────────────────────────────
  if (intentHint === 'compare') {
    const val = valueField ?? numericFields[0];
    if (!primaryDim || !val) return emptyChart(title ?? 'لا توجد بيانات كافية للمقارنة');
    return buildBar(rows, primaryDim, val, title ?? 'المقارنة', theme, rows.length > 12);
  }

  // ── Trend / time series ───────────────────────────────────────────────────
  if (intentHint === 'trend' || (temporalField && !intentHint)) {
    const tField = temporalField ?? fields[0];
    const val = valueField ?? numericFields[0];
    if (!val) return emptyChart(title ?? 'لا توجد بيانات رقمية');
    return buildLine(
      rows,
      tField,
      val,
      dimensionFields.filter((f) => f !== tField && schema[f] === 'string'),
      title ?? 'الاتجاه عبر الزمن',
      theme,
    );
  }

  // ── Part of whole (donut) ─────────────────────────────────────────────────
  if (intentHint === 'part_of_whole') {
    const val = valueField ?? numericFields[0];
    if (primaryDim && val && rows.length <= 12) {
      return buildDonut(rows, primaryDim, val, title ?? 'الحصة', theme);
    }
    // Too many slices → fall through to horizontal bar for readability
    if (primaryDim && val) {
      return buildBar(rows, primaryDim, val, title ?? 'الحصة', theme, true);
    }
    return emptyChart(title ?? 'لا توجد بيانات كافية');
  }

  // ── Distribution (histogram) ──────────────────────────────────────────────
  if (intentHint === 'distribution') {
    const val = valueField ?? numericFields[0];
    if (!val) return emptyChart(title ?? 'لا توجد بيانات رقمية للتوزيع');
    return buildHistogram(rows, val, title ?? 'التوزيع', theme);
  }

  // ── Scatter: two independent numerics, no temporal, no explicit intent ────
  if (!temporalField && !intentHint && numericFields.length >= 2) {
    const [xField, yField] = numericFields;
    return buildScatter(
      rows,
      xField,
      yField,
      dimensionFields[0],
      title ?? `${yField} vs ${xField}`,
      theme,
    );
  }

  // ── Default: bar ──────────────────────────────────────────────────────────
  const val = valueField ?? numericFields[0];
  if (!primaryDim || !val) return emptyChart(title ?? 'لا توجد بيانات كافية');
  return buildBar(rows, primaryDim, val, title ?? 'المقارنة', theme, rows.length > 12);
}

export function getChartTypeCandidates(dataset: z.infer<typeof datasetSchema>): ChartType[] {
  const { rows, schema } = dataset;
  if (rows.length === 0) return ['table'];

  const fields = Object.keys(schema).filter((field) => !isTechnicalField(field));
  const temporalField = fields.find((f) => isTemporalField(f, schema, rows));
  const geoField = fields.find((f) => schema[f] === 'geo');
  const numericFields = fields.filter((f) => schema[f] === 'number' || schema[f] === 'integer');
  const valueField = resolveValueField(fields, schema);
  const dimensionFields = fields.filter(
    (f) => f !== valueField && f !== temporalField && f !== geoField,
  );
  const primaryDim = dimensionFields.find((f) => schema[f] === 'string' || schema[f] === 'boolean')
    ?? dimensionFields[0]
    ?? fields[0];
  const candidates = new Set<ChartType>();

  if (temporalField && valueField) candidates.add('line');
  if (primaryDim && valueField) {
    candidates.add('bar');
    candidates.add('horizontalBar');
    if (rows.length <= 12) candidates.add('donut');
  }
  if (valueField) candidates.add('histogram');
  if (numericFields.length >= 2) candidates.add('scatter');
  if (geoField && valueField) candidates.add('map');
  if (candidates.size === 0) candidates.add('table');

  return [...candidates];
}

export function inferPlotKeys(dataset: z.infer<typeof datasetSchema>) {
  const { rows, schema } = dataset;
  const fields = Object.keys(schema).filter((field) => !isTechnicalField(field));
  const temporal = fields.filter((field) => isTemporalField(field, schema, rows));
  const numeric = fields.filter((field) => schema[field] === 'number' || schema[field] === 'integer');
  const valueField = resolveValueField(fields, schema);
  const categorical = fields.filter(
    (field) => field !== valueField && !temporal.includes(field) && schema[field] !== 'geo',
  );

  return {
    numeric,
    temporal,
    categorical,
    measureKey: valueField ?? numeric[0],
    dimensionKey: temporal[0] ?? categorical[0],
  };
}

function buildRequestedChart({
  chartType,
  rows,
  temporalField,
  geoField,
  numericFields,
  valueField,
  dimensionFields,
  primaryDim,
  title,
  theme,
}: {
  chartType: ChartType;
  rows: Row[];
  temporalField: string | undefined;
  geoField: string | undefined;
  numericFields: string[];
  valueField: string | undefined;
  dimensionFields: string[];
  primaryDim: string | undefined;
  title: string | undefined;
  theme: string;
}) {
  const val = valueField ?? numericFields[0];

  if (chartType === 'line' && temporalField && val) {
    return buildLine(
      rows,
      temporalField,
      val,
      dimensionFields.filter((f) => f !== temporalField),
      title ?? 'الاتجاه عبر الزمن',
      theme,
    );
  }

  if (chartType === 'bar' && primaryDim && val) {
    return buildBar(rows, primaryDim, val, title ?? 'المقارنة', theme, false);
  }

  if (chartType === 'horizontalBar' && primaryDim && val) {
    return buildBar(rows, primaryDim, val, title ?? 'المقارنة', theme, true);
  }

  if (chartType === 'donut' && primaryDim && val && rows.length <= 12) {
    return buildDonut(rows, primaryDim, val, title ?? 'الحصة', theme);
  }

  if (chartType === 'histogram' && val) {
    return buildHistogram(rows, val, title ?? 'التوزيع', theme);
  }

  if (chartType === 'scatter' && numericFields.length >= 2) {
    const [xField, yField] = numericFields;
    return buildScatter(rows, xField, yField, dimensionFields[0], title ?? `${yField} vs ${xField}`, theme);
  }

  if (chartType === 'map' && geoField && val) {
    return buildMap(rows, geoField, val, title ?? 'حسب الموقع', theme);
  }

  if (chartType === 'table') return emptyChart(title ?? 'جدول البيانات');

  return undefined;
}

const BRAND_COLORS = ['#2563eb', '#7c3aed', '#0891b2', '#059669', '#d97706', '#dc2626'];

function baseOption(theme: string) {
  const isDark = theme === 'dark';
  const isBrand = theme === 'brand';
  return {
    backgroundColor: 'transparent',
    color: isBrand ? BRAND_COLORS : undefined,
    textStyle: {
      fontFamily: '"Segoe UI", Tahoma, "Noto Sans Arabic", sans-serif',
      color: isDark ? '#e5e7eb' : isBrand ? '#1e293b' : '#111827',
    },
    grid: { left: 48, right: 24, top: 48, bottom: 48, containLabel: true },
    tooltip: { trigger: 'item' },
    legend: { top: 20 },
  };
}

function buildBar(
  rows: Row[],
  dim: string,
  val: string,
  title: string,
  theme: string,
  horizontal: boolean,
) {
  const cats = rows.map((r) => String(r[dim] ?? ''));
  const vals = rows.map((r) => r[val] ?? null);
  const option: Record<string, unknown> = {
    ...baseOption(theme),
    title: { text: title, left: 0 },
    xAxis: horizontal ? { type: 'value' } : { type: 'category', data: cats },
    yAxis: horizontal ? { type: 'category', data: cats } : { type: 'value' },
    series: [{ type: 'bar', data: vals, name: val }],
    tooltip: { trigger: 'axis' },
  };
  return {
    chartType: horizontal ? ('horizontalBar' as const) : ('bar' as const),
    option,
    title,
    accessibility: { description: `مخطط أعمدة يقارن ${val} عبر ${cats.length} من قيم ${dim}.` },
  };
}

function buildScatter(
  rows: Row[],
  xField: string,
  yField: string,
  groupField: string | undefined,
  title: string,
  theme: string,
) {
  if (groupField) {
    const groups = new Map<string, Array<[number, number]>>();
    for (const r of rows) {
      const x = Number(r[xField]);
      const y = Number(r[yField]);
      if (Number.isNaN(x) || Number.isNaN(y)) continue;
      const key = String(r[groupField] ?? 'unspecified');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push([x, y]);
    }
    const series = [...groups.entries()].map(([name, data]) => ({
      name,
      type: 'scatter',
      data,
      symbolSize: 10,
    }));
    return {
      chartType: 'scatter' as const,
      option: {
        ...baseOption(theme),
        title: { text: title, left: 0 },
        xAxis: { type: 'value', name: xField, scale: true },
        yAxis: { type: 'value', name: yField, scale: true },
        series,
        tooltip: { trigger: 'item' },
      },
      title,
      accessibility: {
        description: `مخطط مبعثر لـ ${yField} مقابل ${xField} عبر ${series.length} مجموعات من ${groupField}.`,
      },
    };
  }

  const data: Array<[number, number]> = [];
  for (const r of rows) {
    const x = Number(r[xField]);
    const y = Number(r[yField]);
    if (!Number.isNaN(x) && !Number.isNaN(y)) data.push([x, y]);
  }
  return {
    chartType: 'scatter' as const,
    option: {
      ...baseOption(theme),
      title: { text: title, left: 0 },
      xAxis: { type: 'value', name: xField, scale: true },
      yAxis: { type: 'value', name: yField, scale: true },
      series: [{ type: 'scatter', data, symbolSize: 10 }],
      tooltip: { trigger: 'item' },
    },
    title,
    accessibility: {
      description: `مخطط مبعثر لـ ${yField} مقابل ${xField} عبر ${data.length} نقاط.`,
    },
  };
}

function buildLine(
  rows: Row[],
  tField: string,
  val: string,
  seriesDims: string[],
  title: string,
  theme: string,
) {
  function sortTimes(times: Set<string>): string[] {
    return [...times].sort((a, b) => {
      const da = Date.parse(a);
      const db = Date.parse(b);
      return Number.isNaN(da) || Number.isNaN(db) ? a.localeCompare(b) : da - db;
    });
  }

  if (seriesDims.length > 0) {
    const seriesKey = seriesDims[0];
    const groups = new Map<string, Map<string, number>>();
    const times = new Set<string>();
    for (const r of rows) {
      const t = String(r[tField] ?? '');
      times.add(t);
      const s = String(r[seriesKey] ?? '');
      if (!groups.has(s)) groups.set(s, new Map());
      groups.get(s)!.set(t, Number(r[val]));
    }
    const sortedTimes = sortTimes(times);
    const series = [...groups.entries()].map(([name, m]) => ({
      name,
      type: 'line',
      smooth: true,
      data: sortedTimes.map((t) => m.get(t) ?? null),
    }));
    return {
      chartType: 'line' as const,
      option: {
        ...baseOption(theme),
        title: { text: title, left: 0 },
        xAxis: { type: 'category', data: sortedTimes },
        yAxis: { type: 'value' },
        series,
        tooltip: { trigger: 'axis' },
      },
      title,
      accessibility: { description: `مخطط خطي لـ ${val} عبر الزمن، بعدد ${series.length} سلاسل.` },
    };
  }

  const times = new Set(rows.map((r) => String(r[tField] ?? '')));
  const sortedTimes = sortTimes(times);
  const timeToVal = new Map(rows.map((r) => [String(r[tField] ?? ''), r[val] ?? null]));
  return {
    chartType: 'line' as const,
    option: {
      ...baseOption(theme),
      title: { text: title, left: 0 },
      xAxis: { type: 'category', data: sortedTimes },
      yAxis: { type: 'value' },
      series: [{ type: 'line', smooth: true, data: sortedTimes.map((t) => timeToVal.get(t) ?? null) }],
      tooltip: { trigger: 'axis' },
    },
    title,
    accessibility: { description: `مخطط خطي لـ ${val} عبر ${sortedTimes.length} نقاط زمنية.` },
  };
}

function buildDonut(rows: Row[], dim: string, val: string, title: string, theme: string) {
  return {
    chartType: 'donut' as const,
    option: {
      ...baseOption(theme),
      title: { text: title, left: 0 },
      series: [
        {
          type: 'pie',
          radius: ['40%', '70%'],
          data: rows.map((r) => ({ name: String(r[dim] ?? ''), value: r[val] ?? null })),
        },
      ],
    },
    title,
    accessibility: { description: `مخطط دائري حلقي يوضح ${rows.length} فئات من ${dim}.` },
  };
}

function buildHistogram(rows: Row[], val: string, title: string, theme: string) {
  const values = rows.map((r) => Number(r[val])).filter((v) => !Number.isNaN(v));
  if (values.length === 0) return emptyChart(title);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const bins = 10;
  const w = (max - min) / bins || 1;
  const buckets = new Array(bins).fill(0);
  for (const v of values) {
    const idx = Math.min(bins - 1, Math.floor((v - min) / w));
    buckets[idx]++;
  }
  const labels = Array.from(
    { length: bins },
    (_, i) => `${(min + i * w).toFixed(1)}–${(min + (i + 1) * w).toFixed(1)}`,
  );
  return {
    chartType: 'histogram' as const,
    option: {
      ...baseOption(theme),
      title: { text: title, left: 0 },
      xAxis: { type: 'category', data: labels },
      yAxis: { type: 'value' },
      series: [{ type: 'bar', data: buckets, name: 'التكرار', barCategoryGap: '0%' }],
      tooltip: { trigger: 'axis' },
    },
    title,
    accessibility: { description: `مدرج تكراري لـ ${val} عبر ${bins} فواصل.` },
  };
}

// Requires the consuming client to have registered a named map via echarts.registerMap().
// Falls back gracefully if called with string-label geo data (handled in buildChartFromDataset).
function buildMap(rows: Row[], geoField: string, val: string, title: string, theme: string) {
  return {
    chartType: 'map' as const,
    option: {
      ...baseOption(theme),
      title: { text: title, left: 0 },
      visualMap: { min: 0, max: Math.max(...rows.map((r) => Number(r[val]) || 0)) },
      series: [
        {
          type: 'map',
          map: 'world',
          data: rows.map((r) => ({ name: r[geoField], value: r[val] })),
        },
      ],
    },
    title,
    accessibility: { description: `خريطة تدرج لوني لـ ${val} حسب ${geoField}.` },
  };
}

function emptyChart(title: string) {
  return {
    chartType: 'table' as const,
    option: { title: { text: title }, series: [] },
    title,
    accessibility: { description: 'لا توجد بيانات متاحة.' },
  };
}

function isTechnicalField(field: string) {
  return field === '_id' || field === 'tenantId' || field.endsWith('Id') || field.startsWith('__');
}

function isTemporalField(field: string, schema: Record<string, string>, rows: Row[]) {
  if (schema[field] === 'date' || schema[field] === 'datetime') return true;
  if (/(date|time|created|updated|day|month|year|يوم|تاريخ|شهر|سنة)/i.test(field)) {
    return rows.some((row) => {
      const value = row[field];
      return typeof value === 'string' && !Number.isNaN(Date.parse(value));
    });
  }
  return false;
}
