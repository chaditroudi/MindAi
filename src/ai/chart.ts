import { generateObject } from 'ai';
import { z } from 'zod';
import { log, logTrace } from '../utils/logger.js';
import { resolveModel, freshSignal } from './model.js';
import { buildChartPrompt } from '../prompts/chart.prompt.js';
import { chartRepo } from '../db/chart-results.repository.js';
import type { DashboardSpec, SkillKind, ChartHint, DataSource, WidgetSpec } from '../types/index.js';

export type WidgetType = string;

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

const MAX_WIDGETS            = Number(process.env.CHART_MAX_WIDGETS ?? 4);
const MAX_TOKENS             = Number(process.env.CHART_MAX_TOKENS ?? 1_500);
const MAX_JSON_DEPTH         = Number(process.env.CHART_JSON_MAX_DEPTH ?? 24);
const MAX_JSON_PROPERTIES    = Number(process.env.CHART_JSON_MAX_PROPERTIES ?? 8_000);
const MAX_TABLE_ROWS         = Number(process.env.CHART_TABLE_MAX_ROWS ?? 100);
const RENDERABLE_OPTION_KEYS = new Set([
  'series',
  'graphic',
  'calendar',
  'geo',
  'parallel',
  'radar',
  'singleAxis',
  'dataset',
  'angleAxis',
  'radiusAxis',
  'visualMap',
]);

const widgetSchema = z.object({
  type:    z.string().min(1),
  title:   z.string().min(1),
  insight: z.string().optional(),
  option:  z.record(z.unknown()).optional(),
  columns: z.array(z.string().min(1)).optional(),
}).superRefine((widget, ctx) => {
  const hasOption = widget.option != null && Object.keys(widget.option).length > 0;
  const isTable = widget.type.trim().toLowerCase() === 'table';
  if (!hasOption && !isTable) {
    ctx.addIssue({
      code:    z.ZodIssueCode.custom,
      message: 'widgets must include a non-empty option object unless type="table".',
      path:    ['option'],
    });
  }
});

const dashboardSchema = z.object({
  layout:  z.enum(['analytical', 'executive', 'operational']),
  summary: z.string().min(1),
  widgets: z.array(widgetSchema).min(1).max(MAX_WIDGETS),
});

type LlmWidget = z.infer<typeof widgetSchema>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeJson(
  value: unknown,
  state: { count: number },
  depth = 0,
): JsonValue | undefined {
  if (depth > MAX_JSON_DEPTH || state.count > MAX_JSON_PROPERTIES) return undefined;
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') {
    state.count += 1;
    return value;
  }
  if (typeof value === 'number') {
    state.count += 1;
    return Number.isFinite(value) ? value : null;
  }
  if (Array.isArray(value)) {
    state.count += 1;
    return value
      .map(item => sanitizeJson(item, state, depth + 1))
      .filter((item): item is JsonValue => item !== undefined);
  }
  if (!isPlainRecord(value)) return undefined;

  state.count += 1;
  const out: Record<string, JsonValue> = {};
  for (const [key, child] of Object.entries(value)) {
    const sanitized = sanitizeJson(child, state, depth + 1);
    if (sanitized !== undefined) out[key] = sanitized;
  }
  return out;
}

function sanitizeOption(option: unknown): Record<string, unknown> | null {
  const sanitized = sanitizeJson(option, { count: 0 });
  if (!isPlainRecord(sanitized) || !Object.keys(sanitized).length) return null;
  return sanitized as Record<string, unknown>;
}

function hasRenderableSignal(option: Record<string, unknown>): boolean {
  return Object.keys(option).some(key => RENDERABLE_OPTION_KEYS.has(key));
}

function hasInlineSeriesData(series: unknown): boolean {
  if (!Array.isArray(series)) return false;
  return series.some(item => isPlainRecord(item) && 'data' in item);
}

function hasSeriesEncode(series: unknown): boolean {
  if (!Array.isArray(series)) return false;
  return series.some(item => isPlainRecord(item) && 'encode' in item);
}

function normalizeDataset(dataset: unknown, rows: Record<string, unknown>[]): unknown {
  if (Array.isArray(dataset)) {
    let injected = false;
    return dataset.map(item => {
      if (!isPlainRecord(item)) return item;
      if (!injected && item['source'] === undefined) {
        injected = true;
        return { ...item, source: rows };
      }
      return item;
    });
  }
  if (isPlainRecord(dataset)) {
    return dataset['source'] === undefined ? { ...dataset, source: rows } : dataset;
  }
  return dataset;
}

function attachDatasetSource(
  option: Record<string, unknown>,
  rows: Record<string, unknown>[],
): Record<string, unknown> {
  if ('dataset' in option) {
    return { ...option, dataset: normalizeDataset(option['dataset'], rows) };
  }

  if (hasSeriesEncode(option['series']) || !hasInlineSeriesData(option['series'])) {
    return { dataset: { source: rows }, ...option };
  }

  return option;
}

function buildTableWidget(
  widget: LlmWidget,
  rows: Record<string, unknown>[],
  rowKeys: Set<string>,
  id: string,
): WidgetSpec {
  const requested = widget.columns?.filter(col => rowKeys.has(col)) ?? [];
  const columns = requested.length ? requested : [...rowKeys];

  return {
    id,
    type:    'table',
    title:   widget.title,
    insight: widget.insight,
    columns,
    rows: rows.slice(0, MAX_TABLE_ROWS).map(row =>
      Object.fromEntries(columns.map(column => [column, row[column]])),
    ),
  };
}

function toWidgetSpec(
  widget: LlmWidget,
  rows: Record<string, unknown>[],
  rowKeys: Set<string>,
  index: number,
): WidgetSpec | null {
  const id = `w${index + 1}`;
  if (widget.type.trim().toLowerCase() === 'table') {
    return buildTableWidget(widget, rows, rowKeys, id);
  }

  const option = sanitizeOption(widget.option);
  if (!option) {
    log('chart', `dropped widget "${widget.title}" — invalid or empty option`);
    return null;
  }
  if (!hasRenderableSignal(option)) {
    log('chart', `dropped widget "${widget.title}" — option has no renderable ECharts content`);
    return null;
  }

  return {
    id,
    type:    widget.type,
    title:   widget.title,
    insight: widget.insight,
    option:  attachDatasetSource(option, rows),
  };
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

  const rowKeys = new Set<string>(rows.flatMap(row => Object.keys(row)));
  const planStart = Date.now();

  let plan: z.infer<typeof dashboardSchema>;
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
    logTrace('chart:llm', 'dashboard plan', plan);
  } catch (err) {
    log('chart', `generateObject failed: ${err instanceof Error ? err.message : err}`);
    return { layout: 'analytical', title: prompt, summary: 'Chart planning failed.', widgets: [] };
  }

  const widgets = plan.widgets
    .slice(0, MAX_WIDGETS)
    .map((widget, index) => toWidgetSpec(widget, rows, rowKeys, index))
    .filter((widget): widget is WidgetSpec => widget !== null);

  const dashboard = {
    layout:  plan.layout,
    title:   prompt,
    summary: plan.summary,
    widgets,
  } satisfies DashboardSpec;

  log('chart', `done | widgets: ${widgets.length} | layout: ${plan.layout}`);
  void chartRepo.save({ prompt, sourceName: source?.name ?? '', dashboard });
  return dashboard;
}
