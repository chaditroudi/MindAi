import type { Mastra } from '@mastra/core/mastra';
import { z } from 'zod';
import { chartPlanSchema, chartResultSchema } from '../schemas/chart.js';
import type { ChartPlan } from '../schemas/chart.js';
import { datasetSchema } from '../schemas/intent.js';
import { buildChartFromDataset, getChartTypeCandidates } from '../tools/chart-tools.js';
import { envTimeout, withTimeout } from './timeout.js';

type Dataset = z.infer<typeof datasetSchema>;
type IntentHint = 'compare' | 'trend' | 'distribution' | 'part_of_whole' | 'geo' | 'ranking';
type ChartType = NonNullable<ChartPlan['chartType']>;
type CompleteChartPlan = ChartPlan & {
  chartType: ChartType;
  xAxisField: string;
  yAxisField: string;
  title: string;
};

export type ChartRuntimeInput = {
  dataset: Dataset;
  intentHint?: IntentHint;
  title?: string;
  theme?: 'light' | 'dark' | 'brand';
  mastra: Mastra;
  // Explicit overrides — caller-supplied values always win over the planner.
  xAxisField?: string;
  yAxisField?: string;
  groupByField?: string;
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

/**
 * Strict chart resolution:
 *
 *  1. ChartPlannerAgent must return a valid structured chart plan.
 *  2. Explicit caller overrides can replace planner field assignments.
 *  3. Deterministic rendering builds the ECharts option from that validated plan.
 *
 * Planner failure is surfaced to the API caller. The runtime does not silently
 * replace failed LLM planning with heuristic chart choices.
 */
export async function runChartRuntime({
  dataset,
  intentHint,
  title,
  theme = 'light',
  mastra,
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
}: ChartRuntimeInput) {
  if (dataset.rows.length === 0) {
    throw new Error('Chart generation failed: dataset is empty.');
  }

  const plannerResult = await runChartPlanner({ dataset, intentHint, title, mastra });
  const resolved = mergeChartPlan(plannerResult, {
    xAxisField,
    yAxisField,
    groupByField,
    title,
  });
  assertCompleteChartPlan(resolved);

  return chartResultSchema.parse(
    buildChartFromDataset({
      dataset,
      intentHint,
      theme,
      title: resolved.title,
      chartType: resolved.chartType,
      xAxisField: resolved.xAxisField,
      yAxisField: resolved.yAxisField,
      groupByField: resolved.groupByField,
      sizeField,
      stackBars,
      bins,
      smooth,
      colorPalette,
      showDataZoom,
      yAxisMin,
      yAxisMax,
      labelFormat,
    }),
  );
}

// ─── Chart Planner ────────────────────────────────────────────────────────────

async function runChartPlanner({
  dataset,
  intentHint,
  title,
  mastra,
}: {
  dataset: Dataset;
  intentHint?: IntentHint;
  title?: string;
  mastra: Mastra;
}): Promise<ChartPlan> {
  const planner = mastra.getAgent('chartPlannerAgent');
  const candidates = getChartTypeCandidates(dataset);
  const technicalPrefixes = new Set(['_id', 'tenantId']);
  const visibleFields = Object.keys(dataset.schema).filter(
    (f) => !technicalPrefixes.has(f) && !f.endsWith('Id') && !f.startsWith('__'),
  );

  // Pass schema + one sample row — never the full rows array.
  const sampleRow = dataset.rows[0]
    ? Object.fromEntries(visibleFields.map((f) => [f, dataset.rows[0][f]]))
    : {};

  const payload = {
    datasetSchema: Object.fromEntries(visibleFields.map((f) => [f, dataset.schema[f]])),
    sampleRow,
    intentHint: intentHint ?? null,
    userPrompt: title ?? '',
    candidateTypes: candidates,
  };

  const result = await withTimeout(
    planner.generate(
      [
        {
          role: 'system',
          content:
            'Return exactly one JSON object matching ChartPlan. Required keys: chartType, xAxisField, yAxisField, title. Optional key: groupByField. No markdown, no prose, no code fence.',
        },
        { role: 'user', content: JSON.stringify(payload) },
      ],
      { output: chartPlanSchema, maxTokens: 256, temperature: 0 },
    ),
    'chart.planner',
    envTimeout('CHART_TIMEOUT_MS', 3000),
  );

  return sanitizePlan({
    plan: result.object,
    dataset,
    visibleFields,
    candidates,
    intentHint,
    fallbackTitle: title,
  });
}

/**
 * Strip invented fields and repair invalid field roles before the renderer sees
 * the plan. The LLM may understand the intent but still swap category/metric
 * fields; this guard keeps ECharts inputs type-correct.
 */
function sanitizePlan({
  plan,
  dataset,
  visibleFields,
  candidates,
  intentHint,
  fallbackTitle,
}: {
  plan: ChartPlan;
  dataset: Dataset;
  visibleFields: string[];
  candidates: ChartType[];
  intentHint?: IntentHint;
  fallbackTitle?: string;
}): ChartPlan {
  const valid = new Set(visibleFields);
  const schema = dataset.schema;
  const numericFields = visibleFields.filter((field) => isNumericField(field, schema));
  const temporalFields = visibleFields.filter((field) => isTemporalField(field, schema, dataset));
  const categoricalFields = visibleFields.filter(
    (field) => !isNumericField(field, schema) && schema[field] !== 'geo',
  );
  const chartType = resolveChartType(plan.chartType, candidates, intentHint);
  const metricField = resolveMetricField(plan.yAxisField, numericFields);
  const dimensionField = resolveDimensionField({
    requested: plan.xAxisField,
    chartType,
    categoricalFields,
    temporalFields,
    numericFields,
    metricField,
  });
  const clusterField = plan.clusters?.find(
    (field) =>
      valid.has(field) &&
      field !== dimensionField &&
      field !== metricField &&
      !isNumericField(field, schema),
  );
  const groupByField =
    clusterField ??
    (plan.groupByField &&
    valid.has(plan.groupByField) &&
    plan.groupByField !== dimensionField &&
    plan.groupByField !== metricField &&
    !isNumericField(plan.groupByField, schema)
      ? plan.groupByField
      : undefined);

  return {
    chartType,
    xAxisField: dimensionField,
    yAxisField: metricField,
    groupByField,
    clusters: groupByField ? [groupByField] : undefined,
    title: plan.title ?? fallbackTitle,
  };
}

function resolveChartType(
  requested: ChartPlan['chartType'],
  candidates: ChartType[],
  intentHint?: IntentHint,
) {
  if (requested && candidates.includes(requested)) return requested;

  const byIntent: Partial<Record<IntentHint, ChartType[]>> = {
    trend: ['line'],
    ranking: ['horizontalBar', 'bar'],
    compare: ['bar', 'horizontalBar'],
    distribution: ['histogram'],
    part_of_whole: ['donut', 'bar'],
    geo: ['map', 'horizontalBar'],
  };
  const preferred = intentHint ? byIntent[intentHint] ?? [] : [];
  return (
    preferred.find((candidate) => candidates.includes(candidate)) ??
    (['line', 'bar', 'horizontalBar', 'histogram', 'scatter', 'donut', 'map', 'table'] as ChartType[]).find(
      (candidate) => candidates.includes(candidate),
    ) ??
    candidates[0]
  );
}

function resolveMetricField(requested: string | undefined, numericFields: string[]) {
  if (requested && numericFields.includes(requested)) return requested;

  const aliases = ['value', 'count', 'total', 'sum', 'average', 'avg', 'rate', 'amount', 'score'];
  return numericFields.find((field) => aliases.includes(field.toLowerCase())) ?? numericFields[0];
}

function resolveDimensionField({
  requested,
  chartType,
  categoricalFields,
  temporalFields,
  numericFields,
  metricField,
}: {
  requested: string | undefined;
  chartType: ChartPlan['chartType'];
  categoricalFields: string[];
  temporalFields: string[];
  numericFields: string[];
  metricField: string | undefined;
}) {
  if (chartType === 'line') {
    if (requested && temporalFields.includes(requested)) return requested;
    return temporalFields[0] ?? categoricalFields[0] ?? numericFields.find((field) => field !== metricField);
  }

  if (chartType === 'histogram') {
    if (requested && numericFields.includes(requested)) return requested;
    return metricField ?? numericFields[0];
  }

  if (chartType === 'scatter') {
    if (requested && numericFields.includes(requested) && requested !== metricField) return requested;
    return numericFields.find((field) => field !== metricField) ?? numericFields[0];
  }

  if (requested && categoricalFields.includes(requested)) return requested;
  return categoricalFields[0] ?? temporalFields[0] ?? numericFields.find((field) => field !== metricField);
}

function isNumericField(field: string, schema: Record<string, string>) {
  return schema[field] === 'number' || schema[field] === 'integer';
}

function isTemporalField(field: string, schema: Record<string, string>, dataset: Dataset) {
  if (schema[field] === 'date' || schema[field] === 'datetime') return true;
  if (!/(date|time|created|updated|day|month|year|يوم|تاريخ|شهر|سنة)/i.test(field)) return false;
  return dataset.rows.some((row) => {
    const value = row[field];
    return typeof value === 'string' && !Number.isNaN(Date.parse(value));
  });
}

/**
 * Merge caller-supplied overrides on top of planner decisions.
 * Explicit caller values always win; undefined means "use planner result".
 */
function mergeChartPlan(
  planner: ChartPlan,
  caller: { xAxisField?: string; yAxisField?: string; groupByField?: string; title?: string },
): ChartPlan {
  return {
    chartType: planner.chartType,
    xAxisField: caller.xAxisField ?? planner.xAxisField,
    yAxisField: caller.yAxisField ?? planner.yAxisField,
    groupByField: caller.groupByField ?? planner.clusters?.[0] ?? planner.groupByField,
    title: caller.title ?? planner.title,
  };
}

function assertCompleteChartPlan(plan: ChartPlan): asserts plan is CompleteChartPlan {
  const missing = [
    !plan.chartType ? 'chartType' : undefined,
    !plan.xAxisField ? 'xAxisField' : undefined,
    !plan.yAxisField ? 'yAxisField' : undefined,
    !plan.title ? 'title' : undefined,
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`Chart planner returned incomplete plan. Missing: ${missing.join(', ')}.`);
  }
}
