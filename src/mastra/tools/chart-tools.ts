import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { datasetSchema } from '../schemas/intent.js';
import { chartResultSchema, chartTypeSchema } from '../schemas/chart.js';

type Row = Record<string, string | number | boolean | null>;
type ChartType = z.infer<typeof chartTypeSchema>;

type ChartOpts = {
  stackBars?: boolean;
  bins?: number;
  smooth?: boolean;
  colorPalette?: string[];
  showDataZoom?: boolean;
  yAxisMin?: number;
  yAxisMax?: number;
  labelFormat?: 'number' | 'currency' | 'percent' | 'compact';
  sizeField?: string;
  seriesGroupField?: string;
};

type BuildChartInput = {
  dataset: z.infer<typeof datasetSchema>;
  intentHint?: 'compare' | 'trend' | 'distribution' | 'part_of_whole' | 'geo' | 'ranking';
  chartType?: ChartType;
  title?: string;
  theme?: 'light' | 'dark' | 'brand';
  // Explicit axis / field overrides — when set, skip heuristic detection for that role
  xAxisField?: string;
  yAxisField?: string;
  groupByField?: string;
  sizeField?: string;
  // Chart-specific knobs
  stackBars?: boolean;
  bins?: number;
  smooth?: boolean;
  colorPalette?: string[];
  showDataZoom?: boolean;
  yAxisMin?: number;
  yAxisMax?: number;
  labelFormat?: 'number' | 'currency' | 'percent' | 'compact';
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
    xAxisField: z.string().optional().describe('Field name to use as the X axis / category dimension. Overrides auto-detection.'),
    yAxisField: z.string().optional().describe('Field name to use as the Y axis / primary metric. Overrides auto-detection.'),
    groupByField: z.string().optional().describe('Field name to split into separate series / clusters / colors. Overrides auto-detection.'),
    sizeField: z.string().optional().describe('Numeric field to map to bubble/scatter point size.'),
    stackBars: z.boolean().optional().describe('Stack grouped bar series instead of placing them side-by-side.'),
    bins: z.number().int().min(2).max(100).optional().describe('Number of bins for histogram charts. Defaults to 10.'),
    smooth: z.boolean().optional().describe('Enable smooth curves on line charts. Defaults to true.'),
    colorPalette: z.array(z.string()).optional().describe('Custom hex color array to override the default palette.'),
    showDataZoom: z.boolean().optional().describe('Add a data-zoom slider below the chart for large datasets.'),
    yAxisMin: z.number().optional().describe('Explicit minimum value for the Y axis.'),
    yAxisMax: z.number().optional().describe('Explicit maximum value for the Y axis.'),
    labelFormat: z.enum(['number', 'currency', 'percent', 'compact']).optional().describe('Numeric label formatting for tooltip and axis values.'),
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
  xAxisField,
  yAxisField,
  groupByField,
  sizeField,
  stackBars,
  bins,
  smooth,
  colorPalette,
  showDataZoom,
  yAxisMin,
  yAxisMax,
  labelFormat,
}: BuildChartInput) {
  const { rows, schema } = dataset;

  if (rows.length === 0) return emptyChart(title ?? 'لا توجد بيانات');

  const fields = Object.keys(schema).filter((field) => !isTechnicalField(field));
  const temporalField = xAxisField && isTemporalField(xAxisField, schema, rows)
    ? xAxisField
    : fields.find((f) => isTemporalField(f, schema, rows));
  const geoField = fields.find((f) => schema[f] === 'geo');
  const numericFields = fields.filter((f) => schema[f] === 'number' || schema[f] === 'integer');
  // Explicit overrides take priority over heuristic detection
  const valueField = yAxisField ?? resolveValueField(fields, schema);
  const dimensionFields = fields.filter(
    (f) => f !== valueField && f !== temporalField && f !== geoField,
  );
  const primaryDim = xAxisField
    ?? dimensionFields.find((f) => schema[f] === 'string' || schema[f] === 'boolean')
    ?? dimensionFields[0]
    ?? fields[0];
  const seriesGroupField = groupByField ?? undefined;

  const opts = { stackBars, bins, smooth, colorPalette, showDataZoom, yAxisMin, yAxisMax, labelFormat, sizeField, seriesGroupField };

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
      opts,
    });
    if (requested) return requested;
  }

  // ── Geo ──────────────────────────────────────────────────────────────────
  if (geoField || intentHint === 'geo') {
    const effectiveGeoField = geoField ?? primaryDim;
    const hasNumericGeo = rows.some((r) => typeof r[effectiveGeoField] === 'number');
    const val = valueField ?? numericFields.find((f) => f !== effectiveGeoField);
    if (hasNumericGeo && val) {
      return buildMap(rows, effectiveGeoField, val, title ?? 'حسب الموقع', theme, opts);
    }
    // String-label geo (zone names, district names) → horizontal bar is more accurate
    if (val) return buildBar(rows, effectiveGeoField, val, title ?? 'حسب المنطقة', theme, true, opts);
    return emptyChart(title ?? 'لا توجد بيانات رقمية');
  }

  // ── Ranking (topN) → horizontal bar, data already sorted DESC ───────────
  if (intentHint === 'ranking') {
    const val = valueField ?? numericFields[0];
    if (!primaryDim || !val) return emptyChart(title ?? 'لا توجد بيانات كافية');
    return buildBar(rows, primaryDim, val, title ?? 'الترتيب', theme, true, opts);
  }

  // ── Explicit compare → bar ────────────────────────────────────────────────
  if (intentHint === 'compare') {
    const val = valueField ?? numericFields[0];
    if (!primaryDim || !val) return emptyChart(title ?? 'لا توجد بيانات كافية للمقارنة');
    return buildBar(rows, primaryDim, val, title ?? 'المقارنة', theme, rows.length > 12, opts);
  }

  // ── Trend / time series ───────────────────────────────────────────────────
  if (intentHint === 'trend' || (temporalField && !intentHint)) {
    const tField = temporalField ?? fields[0];
    const val = valueField ?? numericFields[0];
    if (!val) return emptyChart(title ?? 'لا توجد بيانات رقمية');
    const lineDims = seriesGroupField
      ? [seriesGroupField]
      : dimensionFields.filter((f) => f !== tField && schema[f] === 'string');
    return buildLine(rows, tField, val, lineDims, title ?? 'الاتجاه عبر الزمن', theme, opts);
  }

  // ── Part of whole (donut) ─────────────────────────────────────────────────
  if (intentHint === 'part_of_whole') {
    const val = valueField ?? numericFields[0];
    if (primaryDim && val && rows.length <= 12) {
      return buildDonut(rows, primaryDim, val, title ?? 'الحصة', theme, opts);
    }
    // Too many slices → fall through to horizontal bar for readability
    if (primaryDim && val) {
      return buildBar(rows, primaryDim, val, title ?? 'الحصة', theme, true, opts);
    }
    return emptyChart(title ?? 'لا توجد بيانات كافية');
  }

  // ── Distribution (histogram) ──────────────────────────────────────────────
  if (intentHint === 'distribution') {
    const val = valueField ?? numericFields[0];
    if (!val) return emptyChart(title ?? 'لا توجد بيانات رقمية للتوزيع');
    return buildHistogram(rows, val, title ?? 'التوزيع', theme, opts);
  }

  // ── Scatter: two independent numerics, no temporal, no explicit intent ────
  if (!temporalField && !intentHint && numericFields.length >= 2) {
    const xField = xAxisField && numericFields.includes(xAxisField) ? xAxisField : numericFields[0];
    const yField = yAxisField && numericFields.includes(yAxisField) ? yAxisField : numericFields.find((f) => f !== xField) ?? numericFields[1];
    return buildScatter(
      rows,
      xField,
      yField,
      seriesGroupField ?? dimensionFields[0],
      title ?? `${yField} vs ${xField}`,
      theme,
      opts,
    );
  }

  // ── Default: bar ──────────────────────────────────────────────────────────
  const val = valueField ?? numericFields[0];
  if (!primaryDim || !val) return emptyChart(title ?? 'لا توجد بيانات كافية');
  return buildBar(rows, primaryDim, val, title ?? 'المقارنة', theme, rows.length > 12, opts);
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
  opts,
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
  opts: ChartOpts;
}) {
  const val = valueField ?? numericFields[0];

  if (chartType === 'line' && temporalField && val) {
    const lineDims = opts.seriesGroupField
      ? [opts.seriesGroupField]
      : dimensionFields.filter((f) => f !== temporalField);
    return buildLine(rows, temporalField, val, lineDims, title ?? 'الاتجاه عبر الزمن', theme, opts);
  }

  if (chartType === 'bar' && primaryDim && val) {
    return buildBar(rows, primaryDim, val, title ?? 'المقارنة', theme, false, opts);
  }

  if (chartType === 'horizontalBar' && primaryDim && val) {
    return buildBar(rows, primaryDim, val, title ?? 'المقارنة', theme, true, opts);
  }

  if (chartType === 'donut' && primaryDim && val && rows.length <= 12) {
    return buildDonut(rows, primaryDim, val, title ?? 'الحصة', theme, opts);
  }

  if (chartType === 'histogram' && val) {
    return buildHistogram(rows, val, title ?? 'التوزيع', theme, opts);
  }

  if (chartType === 'scatter' && numericFields.length >= 2) {
    const xField = numericFields[0];
    const yField = numericFields.find((f) => f !== xField) ?? numericFields[1];
    return buildScatter(rows, xField, yField, opts.seriesGroupField ?? dimensionFields[0], title ?? `${yField} vs ${xField}`, theme, opts);
  }

  if (chartType === 'map' && geoField && val) {
    return buildMap(rows, geoField, val, title ?? 'حسب الموقع', theme, opts);
  }

  if (chartType === 'table') return emptyChart(title ?? 'جدول البيانات');

  return undefined;
}

const BRAND_COLORS = ['#2563eb', '#7c3aed', '#0891b2', '#059669', '#d97706', '#dc2626'];

const LABEL_FORMATTERS: Record<string, string> = {
  currency: '{c} ر.س',
  percent: '{c}%',
  compact: '{c}',
  number: '{c}',
};

function baseOption(theme: string, opts: ChartOpts = {}) {
  const isDark = theme === 'dark';
  const isBrand = theme === 'brand';
  const palette = opts.colorPalette ?? (isBrand ? BRAND_COLORS : undefined);
  return {
    backgroundColor: 'transparent',
    color: palette,
    textStyle: {
      fontFamily: '"Segoe UI", Tahoma, "Noto Sans Arabic", sans-serif',
      color: isDark ? '#e5e7eb' : isBrand ? '#1e293b' : '#111827',
    },
    grid: { left: 48, right: 24, top: 48, bottom: 48, containLabel: true },
    tooltip: {
      trigger: 'item',
      ...(opts.labelFormat && opts.labelFormat !== 'number'
        ? { valueFormatter: (v: number) => LABEL_FORMATTERS[opts.labelFormat!].replace('{c}', String(v)) }
        : {}),
    },
    legend: { top: 20 },
    ...(opts.showDataZoom
      ? { dataZoom: [{ type: 'slider', bottom: 8 }, { type: 'inside' }] }
      : {}),
  };
}

function buildBar(
  rows: Row[],
  dim: string,
  val: string,
  title: string,
  theme: string,
  horizontal: boolean,
  opts: ChartOpts = {},
) {
  const cats = rows.map((r) => String(r[dim] ?? ''));
  const yAxisOpts = {
    type: 'value' as const,
    ...(opts.yAxisMin !== undefined ? { min: opts.yAxisMin } : {}),
    ...(opts.yAxisMax !== undefined ? { max: opts.yAxisMax } : {}),
  };

  // Multi-series grouped/stacked bar when a groupByField is present
  if (opts.seriesGroupField && rows.some((r) => r[opts.seriesGroupField!] !== undefined)) {
    const groupValues = [...new Set(rows.map((r) => String(r[opts.seriesGroupField!] ?? '')))];
    const catSet = [...new Set(cats)];
    const series = groupValues.map((g) => ({
      name: g,
      type: 'bar' as const,
      stack: opts.stackBars ? 'total' : undefined,
      data: catSet.map((c) => {
        const match = rows.find((r) => String(r[dim] ?? '') === c && String(r[opts.seriesGroupField!] ?? '') === g);
        return match ? (match[val] ?? null) : null;
      }),
    }));
    const option: Record<string, unknown> = {
      ...baseOption(theme, opts),
      title: { text: title, left: 0 },
      xAxis: horizontal ? { ...yAxisOpts } : { type: 'category', data: catSet },
      yAxis: horizontal ? { type: 'category', data: catSet } : { ...yAxisOpts },
      series,
      tooltip: { trigger: 'axis' },
    };
    return {
      chartType: horizontal ? ('horizontalBar' as const) : ('bar' as const),
      option,
      title,
      accessibility: { description: `مخطط أعمدة ${opts.stackBars ? 'متراكم' : 'مجمّع'} لـ ${val} عبر ${catSet.length} من قيم ${dim} بتقسيم ${groupValues.length} فئات من ${opts.seriesGroupField}.` },
    };
  }

  const vals = rows.map((r) => r[val] ?? null);
  const option: Record<string, unknown> = {
    ...baseOption(theme, opts),
    title: { text: title, left: 0 },
    xAxis: horizontal ? { ...yAxisOpts } : { type: 'category', data: cats },
    yAxis: horizontal ? { type: 'category', data: cats } : { ...yAxisOpts },
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
  opts: ChartOpts = {},
) {
  const hasSizeField = opts.sizeField && rows.some((r) => r[opts.sizeField!] !== undefined);

  function makePoint(r: Row): [number, number] | [number, number, number] {
    const x = Number(r[xField]);
    const y = Number(r[yField]);
    if (hasSizeField) return [x, y, Number(r[opts.sizeField!])];
    return [x, y];
  }

  const symbolSize = hasSizeField
    ? (val: number[]) => Math.sqrt(val[2]) * 3
    : 10;

  if (groupField) {
    const groups = new Map<string, Array<[number, number] | [number, number, number]>>();
    for (const r of rows) {
      const x = Number(r[xField]);
      const y = Number(r[yField]);
      if (Number.isNaN(x) || Number.isNaN(y)) continue;
      const key = String(r[groupField] ?? 'unspecified');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(makePoint(r));
    }
    const series = [...groups.entries()].map(([name, data]) => ({
      name,
      type: 'scatter',
      data,
      symbolSize,
    }));
    return {
      chartType: 'scatter' as const,
      option: {
        ...baseOption(theme, opts),
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

  const data: Array<[number, number] | [number, number, number]> = [];
  for (const r of rows) {
    const x = Number(r[xField]);
    const y = Number(r[yField]);
    if (!Number.isNaN(x) && !Number.isNaN(y)) data.push(makePoint(r));
  }
  return {
    chartType: 'scatter' as const,
    option: {
      ...baseOption(theme, opts),
      title: { text: title, left: 0 },
      xAxis: { type: 'value', name: xField, scale: true },
      yAxis: { type: 'value', name: yField, scale: true },
      series: [{ type: 'scatter', data, symbolSize }],
      tooltip: { trigger: 'item' },
    },
    title,
    accessibility: {
      description: `مخطط مبعثر${hasSizeField ? ' فقاعي' : ''} لـ ${yField} مقابل ${xField} عبر ${data.length} نقاط.`,
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
  opts: ChartOpts = {},
) {
  const isSmooth = opts.smooth !== false; // default true
  const yAxisOpts = {
    type: 'value' as const,
    ...(opts.yAxisMin !== undefined ? { min: opts.yAxisMin } : {}),
    ...(opts.yAxisMax !== undefined ? { max: opts.yAxisMax } : {}),
  };

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
      smooth: isSmooth,
      data: sortedTimes.map((t) => m.get(t) ?? null),
    }));
    return {
      chartType: 'line' as const,
      option: {
        ...baseOption(theme, opts),
        title: { text: title, left: 0 },
        xAxis: { type: 'category', data: sortedTimes },
        yAxis: yAxisOpts,
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
      ...baseOption(theme, opts),
      title: { text: title, left: 0 },
      xAxis: { type: 'category', data: sortedTimes },
      yAxis: yAxisOpts,
      series: [{ type: 'line', smooth: isSmooth, data: sortedTimes.map((t) => timeToVal.get(t) ?? null) }],
      tooltip: { trigger: 'axis' },
    },
    title,
    accessibility: { description: `مخطط خطي لـ ${val} عبر ${sortedTimes.length} نقاط زمنية.` },
  };
}

function buildDonut(rows: Row[], dim: string, val: string, title: string, theme: string, opts: ChartOpts = {}) {
  return {
    chartType: 'donut' as const,
    option: {
      ...baseOption(theme, opts),
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

function buildHistogram(rows: Row[], val: string, title: string, theme: string, opts: ChartOpts = {}) {
  const values = rows.map((r) => Number(r[val])).filter((v) => !Number.isNaN(v));
  if (values.length === 0) return emptyChart(title);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const binCount = opts.bins ?? 10;
  const w = (max - min) / binCount || 1;
  const buckets = new Array(binCount).fill(0);
  for (const v of values) {
    const idx = Math.min(binCount - 1, Math.floor((v - min) / w));
    buckets[idx]++;
  }
  const labels = Array.from(
    { length: binCount },
    (_, i) => `${(min + i * w).toFixed(1)}–${(min + (i + 1) * w).toFixed(1)}`,
  );
  return {
    chartType: 'histogram' as const,
    option: {
      ...baseOption(theme, opts),
      title: { text: title, left: 0 },
      xAxis: { type: 'category', data: labels },
      yAxis: { type: 'value' },
      series: [{ type: 'bar', data: buckets, name: 'التكرار', barCategoryGap: '0%' }],
      tooltip: { trigger: 'axis' },
    },
    title,
    accessibility: { description: `مدرج تكراري لـ ${val} عبر ${binCount} فواصل.` },
  };
}

// Requires the consuming client to have registered a named map via echarts.registerMap().
// Falls back gracefully if called with string-label geo data (handled in buildChartFromDataset).
function buildMap(rows: Row[], geoField: string, val: string, title: string, theme: string, opts: ChartOpts = {}) {
  return {
    chartType: 'map' as const,
    option: {
      ...baseOption(theme, opts),
      title: { text: title, left: 0 },
      visualMap: {
        min: opts.yAxisMin ?? 0,
        max: opts.yAxisMax ?? Math.max(...rows.map((r) => Number(r[val]) || 0)),
      },
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
