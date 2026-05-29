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

export type ChartRuntimeInput = {
  dataset: Dataset;
  intentHint?: IntentHint;
  title?: string;
  theme?: 'light' | 'dark' | 'brand';
  mastra: Mastra;
  // Supervisor field suggestions passed to Chart Agent as hints.
  preferredXAxisField?: string;
  preferredYAxisField?: string;
  preferredGroupByField?: string;
  // Rendering knobs — passed straight to chart-tools, no LLM involved.
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
 * Chart resolution:
 *
 *  1. Chart Agent LLM receives the MongoDB pipeline output (schema + sample rows
 *     + row count) plus supervisor hints and the user prompt.
 *  2. The agent decides chartType, xAxisField, yAxisField, groupByField, title.
 *  3. validateChartPlan() ensures every field name exists in the real schema.
 *  4. buildChartFromDataset() converts the validated plan into ECharts config.
 *
 * Empty datasets skip the agent and return an empty chart immediately.
 * The agent is the sole decision maker — there is no deterministic fallback.
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
      buildChartFromDataset({ dataset, theme, title: title ?? 'لا توجد بيانات مطابقة' }),
    );
  }

  const plan = await runChartPlanner({
    dataset,
    intentHint,
    title,
    mastra,
    preferredXAxisField,
    preferredYAxisField,
    preferredGroupByField,
  });

  return chartResultSchema.parse(
    buildChartFromDataset({
      dataset,
      intentHint,
      theme,
      title: plan.title ?? title,
      chartType: plan.chartType,
      xAxisField: plan.xAxisField,
      yAxisField: plan.yAxisField,
      groupByField: plan.clusters?.[0] ?? plan.groupByField,
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
  preferredXAxisField,
  preferredYAxisField,
  preferredGroupByField,
}: {
  dataset: Dataset;
  intentHint?: IntentHint;
  title?: string;
  mastra: Mastra;
  preferredXAxisField?: string;
  preferredYAxisField?: string;
  preferredGroupByField?: string;
}): Promise<ChartPlan> {
  const planner = mastra.getAgent('chartPlannerAgent');
  const candidates = getChartTypeCandidates(dataset);

  const technicalPrefixes = new Set(['_id', 'tenantId']);
  const visibleFields = Object.keys(dataset.schema).filter(
    (f) => !technicalPrefixes.has(f) && !f.endsWith('Id') && !f.startsWith('__'),
  );

  const sampleRows = dataset.rows.slice(0, 3).map((row) =>
    Object.fromEntries(visibleFields.map((f) => [f, row[f]])),
  );

  const payload = {
    datasetSchema: Object.fromEntries(visibleFields.map((f) => [f, dataset.schema[f]])),
    sampleRows,
    rowCount: dataset.rows.length,
    supervisorHints: {
      intentHint: intentHint ?? null,
      suggestedXAxis: preferredXAxisField ?? null,
      suggestedYAxis: preferredYAxisField ?? null,
      suggestedGroupBy: preferredGroupByField ?? null,
    },
    userPrompt: title ?? '',
    candidateTypes: candidates,
  };

  const result = await withTimeout(
    planner.generate(
      [{ role: 'user', content: JSON.stringify(payload) }],
      { output: chartPlanSchema, maxTokens: 400, temperature: 0 },
    ),
    'chart.planner',
    envTimeout('CHART_TIMEOUT_MS', 8000),
  );

  return validateChartPlan(result.object, visibleFields, candidates, title);
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validateChartPlan(
  plan: ChartPlan,
  visibleFields: string[],
  candidates: ChartType[],
  fallbackTitle?: string,
): ChartPlan {
  const valid = new Set(visibleFields);

  if (!plan.chartType || !candidates.includes(plan.chartType)) {
    throw new Error(`Chart agent returned invalid chartType: "${plan.chartType}". Must be one of: ${candidates.join(', ')}`);
  }

  if (!plan.xAxisField || !valid.has(plan.xAxisField)) {
    throw new Error(`Chart agent returned invalid xAxisField: "${plan.xAxisField}". Must exist in dataset schema.`);
  }

  if (!plan.yAxisField || !valid.has(plan.yAxisField)) {
    throw new Error(`Chart agent returned invalid yAxisField: "${plan.yAxisField}". Must exist in dataset schema.`);
  }

  const groupByField = plan.clusters?.[0] ?? plan.groupByField;
  if (groupByField && !valid.has(groupByField)) {
    throw new Error(`Chart agent returned invalid groupByField: "${groupByField}". Must exist in dataset schema.`);
  }

  return {
    chartType: plan.chartType,
    xAxisField: plan.xAxisField,
    yAxisField: plan.yAxisField,
    groupByField: groupByField ?? undefined,
    clusters: groupByField ? [groupByField] : undefined,
    title: plan.title ?? fallbackTitle,
  };
}
