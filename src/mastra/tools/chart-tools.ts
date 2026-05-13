import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { datasetSchema } from '../schemas/intent.js';
import { chartResultSchema } from '../schemas/chart.js';

type BuildChartInput = {
  dataset: z.infer<typeof datasetSchema>;
  intentHint?: 'compare' | 'trend' | 'distribution' | 'part_of_whole' | 'geo';
  title?: string;
  theme?: 'light' | 'dark' | 'brand';
};

export const buildEChartsTool = createTool({
  id: 'build-echarts',
  description:
    'Choose the best chart type for the given dataset and return a complete ECharts option object, plus accessibility text.',
  inputSchema: z.object({
    dataset: datasetSchema,
    intentHint: z.enum(['compare', 'trend', 'distribution', 'part_of_whole', 'geo']).optional(),
    title: z.string().optional(),
    theme: z.enum(['light', 'dark', 'brand']).default('light'),
  }),
  outputSchema: chartResultSchema,
  execute: async ({ context }) => buildChartFromDataset(context),
});

export function buildChartFromDataset({
  dataset,
  intentHint,
  title,
  theme = 'light',
}: BuildChartInput) {
  const { rows, schema } = dataset;

  if (rows.length === 0) {
    return emptyChart(title ?? 'No data');
  }

  const fields = Object.keys(schema).filter((field) => !isTechnicalField(field));
  const temporalField = fields.find((f) => schema[f] === 'date' || schema[f] === 'datetime');
  const geoField = fields.find((f) => schema[f] === 'geo');
  const valueField =
    fields.find((f) => f === 'value') ??
    fields.find((f) => schema[f] === 'number' || schema[f] === 'integer');
  const dimensionFields = fields.filter((f) => f !== valueField && f !== temporalField);

  if (geoField || intentHint === 'geo') {
    return buildMap(
      rows,
      geoField ?? dimensionFields[0],
      valueField ?? 'value',
      title ?? 'By location',
      theme,
    );
  }

  if (intentHint === 'trend' || (temporalField && !intentHint)) {
    const tField = temporalField ?? fields[0];
    return buildLine(
      rows,
      tField,
      valueField ?? 'value',
      dimensionFields.filter((d) => d !== tField),
      title ?? 'Trend over time',
      theme,
    );
  }

  if (intentHint === 'part_of_whole' && rows.length < 7) {
    return buildDonut(rows, dimensionFields[0], valueField ?? 'value', title ?? 'Share', theme);
  }

  if (intentHint === 'distribution') {
    return buildHistogram(rows, valueField ?? 'value', title ?? 'Distribution', theme);
  }

  if (rows.length > 12) {
    return buildBar(
      rows,
      dimensionFields[0],
      valueField ?? 'value',
      title ?? 'Comparison',
      theme,
      true,
    );
  }

  return buildBar(
    rows,
    dimensionFields[0] ?? fields[0],
    valueField ?? 'value',
    title ?? 'Comparison',
    theme,
    false,
  );
}

function baseOption(theme: string) {
  return {
    backgroundColor: 'transparent',
    textStyle: {
      fontFamily: 'Inter, system-ui, sans-serif',
      color: theme === 'dark' ? '#e5e7eb' : '#111827',
    },
    grid: { left: 48, right: 24, top: 48, bottom: 48, containLabel: true },
    tooltip: { trigger: 'item' },
    legend: { top: 20 },
  };
}

function buildBar(
  rows: any[],
  dim: string,
  val: string,
  title: string,
  theme: string,
  horizontal: boolean,
) {
  const cats = rows.map((r) => r[dim]);
  const vals = rows.map((r) => r[val]);
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
    accessibility: { description: `Bar chart comparing ${val} across ${cats.length} ${dim} values.` },
  };
}

function buildLine(
  rows: any[],
  tField: string,
  val: string,
  seriesDims: string[],
  title: string,
  theme: string,
) {
  if (seriesDims.length > 0) {
    const seriesKey = seriesDims[0];
    const groups = new Map<string, Map<string, number>>();
    const times = new Set<string>();
    for (const r of rows) {
      const t = String(r[tField]);
      times.add(t);
      const s = String(r[seriesKey]);
      if (!groups.has(s)) groups.set(s, new Map());
      groups.get(s)!.set(t, Number(r[val]));
    }
    const sortedTimes = [...times].sort();
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
      accessibility: { description: `Line chart of ${val} over time, ${series.length} series.` },
    };
  }
  return {
    chartType: 'line' as const,
    option: {
      ...baseOption(theme),
      title: { text: title, left: 0 },
      xAxis: { type: 'category', data: rows.map((r) => r[tField]) },
      yAxis: { type: 'value' },
      series: [{ type: 'line', smooth: true, data: rows.map((r) => r[val]) }],
      tooltip: { trigger: 'axis' },
    },
    title,
    accessibility: { description: `Line chart of ${val} over ${rows.length} time points.` },
  };
}

function buildDonut(rows: any[], dim: string, val: string, title: string, theme: string) {
  return {
    chartType: 'donut' as const,
    option: {
      ...baseOption(theme),
      title: { text: title, left: 0 },
      series: [
        {
          type: 'pie',
          radius: ['40%', '70%'],
          data: rows.map((r) => ({ name: r[dim], value: r[val] })),
        },
      ],
    },
    title,
    accessibility: { description: `Donut chart of ${rows.length} ${dim} slices.` },
  };
}

function buildHistogram(rows: any[], val: string, title: string, theme: string) {
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
  const labels = Array.from({ length: bins }, (_, i) => `${(min + i * w).toFixed(1)}–${(min + (i + 1) * w).toFixed(1)}`);
  return {
    chartType: 'histogram' as const,
    option: {
      ...baseOption(theme),
      title: { text: title, left: 0 },
      xAxis: { type: 'category', data: labels },
      yAxis: { type: 'value' },
      series: [{ type: 'bar', data: buckets, name: 'frequency', barCategoryGap: '0%' }],
      tooltip: { trigger: 'axis' },
    },
    title,
    accessibility: { description: `Histogram of ${val} across ${bins} bins.` },
  };
}

function buildMap(rows: any[], geoField: string, val: string, title: string, theme: string) {
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
    accessibility: { description: `Choropleth map of ${val} by ${geoField}.` },
  };
}

function emptyChart(title: string) {
  return {
    chartType: 'table' as const,
    option: { title: { text: title }, series: [] },
    title,
    accessibility: { description: 'No data available.' },
  };
}

function isTechnicalField(field: string) {
  return field === '_id' || field === 'tenantId' || field.endsWith('Id');
}
