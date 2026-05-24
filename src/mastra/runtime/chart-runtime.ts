import type { Mastra } from '@mastra/core/mastra';
import { z } from 'zod';
import { chartPlanSchema, chartResultSchema } from '../schemas/chart.js';
import type { ChartPlan } from '../schemas/chart.js';
import { datasetSchema } from '../schemas/intent.js';
import { buildChartFromDataset, getChartTypeCandidates } from '../tools/chart-tools.js';
import { parseJsonOutput } from './json-output.js';
import { envTimeout, withTimeout } from './timeout.js';

type Dataset = z.infer<typeof datasetSchema>;
type IntentHint = 'compare' | 'trend' | 'distribution' | 'part_of_whole' | 'geo' | 'ranking';
type CompleteChartPlan = ChartPlan & {
  chartType: NonNullable<ChartPlan['chartType']>;
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
      { maxTokens: 256, temperature: 0 },
    ),
    'chart.planner',
    envTimeout('CHART_TIMEOUT_MS', 3000),
  );

  return sanitizePlan(parseJsonOutput(result.text, chartPlanSchema), visibleFields);
}

/**
 * Strip any field names the LLM invented that don't exist in the actual schema.
 * chartType is kept as-is; the builder validates it implicitly.
 */
function sanitizePlan(plan: ChartPlan, validFields: string[]): ChartPlan {
  const valid = new Set(validFields);
  return {
    chartType: plan.chartType,
    xAxisField: plan.xAxisField && valid.has(plan.xAxisField) ? plan.xAxisField : undefined,
    yAxisField: plan.yAxisField && valid.has(plan.yAxisField) ? plan.yAxisField : undefined,
    groupByField: plan.groupByField && valid.has(plan.groupByField) ? plan.groupByField : undefined,
    title: plan.title,
  };
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
    groupByField: caller.groupByField ?? planner.groupByField,
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
