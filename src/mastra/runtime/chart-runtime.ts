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
type ChartFieldHints = {
  xAxisField?: string;
  yAxisField?: string;
  groupByField?: string;
};
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
  // Supervisor hints passed into the Chart Agent. They guide planning but are
  // not hard overrides.
  preferredXAxisField?: string;
  preferredYAxisField?: string;
  preferredGroupByField?: string;
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
 *  1. ChartPlannerAgent receives the dataset shape and supervisor hints.
 *  2. Its structured plan is sanitized against real dataset fields.
 *  3. Explicit caller overrides can replace planner field assignments.
 *  4. Deterministic rendering builds the ECharts option from that validated plan.
 *
 * Planner failure falls back to deterministic rendering with supervisor hints.
 * This keeps dashboards available while making the chart agent the primary
 * visualization planner for non-empty datasets.
 */
export async function runChartRuntime({
  dataset,
  intentHint,
  title,
  theme = 'light',
  mastra,
  preferredXAxisField,
  preferredYAxisField,
  preferredGroupByField,
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
    return chartResultSchema.parse(
      buildChartFromDataset({
        dataset,
        intentHint,
        theme,
        title: title ?? 'لا توجد بيانات مطابقة',
      }),
    );
  }

  let plannerResult: ChartPlan | undefined;
  const preferredFields = {
    xAxisField: preferredXAxisField,
    yAxisField: preferredYAxisField,
    groupByField: preferredGroupByField,
  };

  try {
    plannerResult = await runChartPlanner({ dataset, intentHint, title, preferredFields, mastra });
  } catch {
    // Planner failed — fall through to deterministic renderer below
  }

  if (plannerResult) {
    const resolved = mergeChartPlan(plannerResult, { xAxisField, yAxisField, groupByField, title });
    if (isCompleteChartPlan(resolved)) {
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
  }

  // Planner incomplete or failed — deterministic renderer as final fallback
  const fallbackXAxisField = xAxisField ?? preferredXAxisField;
  const fallbackYAxisField = yAxisField ?? preferredYAxisField;
  const fallbackGroupByField = groupByField ?? preferredGroupByField;
  return chartResultSchema.parse(
    buildChartFromDataset({
      dataset,
      intentHint,
      theme,
      title,
      chartType: resolveDeterministicChartType({
        dataset,
        intentHint,
        title,
        xAxisField: fallbackXAxisField,
        groupByField: fallbackGroupByField,
      }),
      xAxisField: fallbackXAxisField,
      yAxisField: fallbackYAxisField,
      groupByField: fallbackGroupByField,
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

function resolveDeterministicChartType({
  dataset,
  intentHint,
  title,
  xAxisField,
  groupByField,
}: {
  dataset: Dataset;
  intentHint?: IntentHint;
  title?: string;
  xAxisField?: string;
  groupByField?: string;
}): ChartType | undefined {
  if (isClusteredBarRequest(title) && groupByField) return 'bar';
  if (/\bscatter\b/i.test(title ?? '')) return 'scatter';
  if (/\bhistogram\b|\bdistribution\b/i.test(title ?? '')) return 'histogram';
  if (/\bdonut\b|\bpie\b|\bshare\b|\bpercentage\b|\bpercent\b/i.test(title ?? '')) return 'donut';
  if (intentHint === 'ranking') return 'horizontalBar';
  if (intentHint === 'trend') return 'line';
  if (intentHint === 'distribution') return 'histogram';
  if (intentHint === 'part_of_whole') return 'donut';
  if (intentHint === 'geo') return 'map';
  if (groupByField && (!xAxisField || !isTemporalField(xAxisField, dataset.schema, dataset))) return 'bar';
  return undefined;
}

// ─── Chart Planner ────────────────────────────────────────────────────────────

async function runChartPlanner({
  dataset,
  intentHint,
  title,
  preferredFields,
  mastra,
}: {
  dataset: Dataset;
  intentHint?: IntentHint;
  title?: string;
  preferredFields: ChartFieldHints;
  mastra: Mastra;
}): Promise<ChartPlan> {
  const planner = mastra.getAgent('chartPlannerAgent');
  const candidates = getChartTypeCandidates(dataset);
  const technicalPrefixes = new Set(['_id', 'tenantId']);
  const visibleFields = Object.keys(dataset.schema).filter(
    (f) => !technicalPrefixes.has(f) && !f.endsWith('Id') && !f.startsWith('__'),
  );

  // Pass a tiny sample only — never the full rows array.
  const sampleRows = dataset.rows.slice(0, 3).map((row) =>
    Object.fromEntries(visibleFields.map((f) => [f, row[f]])),
  );
  const fieldHints = sanitizeFieldHints(preferredFields, visibleFields);

  const payload = {
    datasetSchema: Object.fromEntries(visibleFields.map((f) => [f, dataset.schema[f]])),
    sampleRows,
    rowCount: dataset.rows.length,
    supervisorHints: {
      intentHint: intentHint ?? null,
      suggestedXAxis: fieldHints.xAxisField ?? null,
      suggestedYAxis: fieldHints.yAxisField ?? null,
      suggestedGroupBy: fieldHints.groupByField ?? null,
    },
    userPrompt: title ?? '',
    candidateTypes: candidates,
  };

  const result = await withTimeout(
    planner.generate(
      [{ role: 'user', content: JSON.stringify(payload) }],
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
    preferredFields: fieldHints,
    fallbackTitle: title,
  });
}

function sanitizeFieldHints(preferredFields: ChartFieldHints, visibleFields: string[]): ChartFieldHints {
  const valid = new Set(visibleFields);
  return {
    xAxisField: preferredFields.xAxisField && valid.has(preferredFields.xAxisField)
      ? preferredFields.xAxisField
      : undefined,
    yAxisField: preferredFields.yAxisField && valid.has(preferredFields.yAxisField)
      ? preferredFields.yAxisField
      : undefined,
    groupByField: preferredFields.groupByField && valid.has(preferredFields.groupByField)
      ? preferredFields.groupByField
      : undefined,
  };
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
  preferredFields,
  fallbackTitle,
}: {
  plan: ChartPlan;
  dataset: Dataset;
  visibleFields: string[];
  candidates: ChartType[];
  intentHint?: IntentHint;
  preferredFields: ChartFieldHints;
  fallbackTitle?: string;
}): ChartPlan {
  const valid = new Set(visibleFields);
  const schema = dataset.schema;
  const numericFields = visibleFields.filter((field) => isNumericField(field, schema));
  const temporalFields = visibleFields.filter((field) => isTemporalField(field, schema, dataset));
  const categoricalFields = visibleFields.filter(
    (field) => !isNumericField(field, schema) && schema[field] !== 'geo',
  );
  const prefersClusteredBar = isClusteredBarRequest(fallbackTitle);
  const chartType = prefersClusteredBar && candidates.includes('bar')
    ? 'bar'
    : resolveChartType(plan.chartType, candidates, intentHint);
  const metricField = resolveMetricField(plan.yAxisField ?? preferredFields.yAxisField, numericFields);
  const dimensionField = resolveDimensionField({
    requested: plan.xAxisField ?? preferredFields.xAxisField,
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
  const preferredGroupByField =
    preferredFields.groupByField &&
    valid.has(preferredFields.groupByField) &&
    preferredFields.groupByField !== dimensionField &&
    preferredFields.groupByField !== metricField &&
    !isNumericField(preferredFields.groupByField, schema)
      ? preferredFields.groupByField
      : undefined;
  const groupByField =
    clusterField ??
    (plan.groupByField &&
    valid.has(plan.groupByField) &&
    plan.groupByField !== dimensionField &&
    plan.groupByField !== metricField &&
    !isNumericField(plan.groupByField, schema)
      ? plan.groupByField
      : undefined) ??
    preferredGroupByField;
  const inferredGroupByField = inferGroupByField({
    chartType,
    dimensionField,
    metricField,
    categoricalFields,
    temporalFields,
    prefersClusteredBar,
  });
  const resolvedGroupByField = groupByField ?? inferredGroupByField;

  return {
    chartType,
    xAxisField: dimensionField,
    yAxisField: metricField,
    groupByField: resolvedGroupByField,
    clusters: resolvedGroupByField ? [resolvedGroupByField] : undefined,
    title: plan.title ?? fallbackTitle,
  };
}

function inferGroupByField({
  chartType,
  dimensionField,
  metricField,
  categoricalFields,
  temporalFields,
  prefersClusteredBar,
}: {
  chartType: ChartType;
  dimensionField: string | undefined;
  metricField: string | undefined;
  categoricalFields: string[];
  temporalFields: string[];
  prefersClusteredBar: boolean;
}) {
  if (!dimensionField || !metricField) return undefined;

  const candidate = categoricalFields.find((field) => field !== dimensionField && field !== metricField);
  if (!candidate) return undefined;

  if (chartType === 'bar' || chartType === 'horizontalBar' || chartType === 'scatter') return candidate;
  if (chartType === 'line' && temporalFields.includes(dimensionField)) return candidate;
  if (prefersClusteredBar) return candidate;
  return undefined;
}

function isClusteredBarRequest(title: string | undefined) {
  if (!title) return false;
  return /\b(clustered|cluster|grouped|group|group\s+bar|clustered\s+bar)\b/i.test(title);
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

function isCompleteChartPlan(plan: ChartPlan): plan is CompleteChartPlan {
  return Boolean(plan.chartType && plan.xAxisField && plan.yAxisField && plan.title);
}
