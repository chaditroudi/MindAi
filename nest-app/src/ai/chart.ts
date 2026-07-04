import { z } from 'zod';
import { log, logTrace } from '../common/logger/app.logger';
import {
  createSkillAgent,
  freshSignal,
  skillProviderOptions,
  withRateLimitRetry,
} from './model';
import { readMarkdownSection, skillFile } from './skill-prompt';
import type { TokenUsage } from './token';
import { buildChartPrompt } from '../prompts';
import type {
  DashboardSpec,
  SkillKind,
  ChartHint,
  DataSource,
  WidgetSpec,
} from '../types';

/**
 * chart.ts — the "chart" agent role
 * ----------------------------------
 * Unlike the planner (which produces a small structured plan) or the writer
 * (which produces plain prose), this skill asks the LLM to *author* a
 * complete ECharts `option` object per widget — real chart design, not a
 * template pick. Because of that, this file carries a lot more runtime
 * responsibility than the other skills: validating the shape is minimally
 * sane, injecting the real row data the model was never actually shown in
 * full, and dropping anything that wouldn't actually render.
 *
 * The model is NOT trusted to reconcile a chart hint against what the data
 * can actually support (e.g. asking for a scatter plot when there's only one
 * numeric field) — that reconciliation now lives in the chart skill's own
 * SKILL.md instructions instead of hardcoded TypeScript, so the model reasons
 * about it directly against the real column profile it's shown.
 */

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

const CHART_INSTRUCTIONS = readMarkdownSection(
  skillFile('chart', 'SKILL.md'),
  'System Instructions',
);

const MAX_WIDGETS = Number(process.env['CHART_MAX_WIDGETS'] ?? 4);
const MAX_TOKENS = Number(process.env['CHART_MAX_TOKENS'] ?? 2_000);
// Depth/property caps for sanitizeJson below — a hard ceiling against a
// pathological or malformed LLM response ballooning into something huge
// before it's ever rendered.
const MAX_JSON_DEPTH = Number(process.env['CHART_JSON_MAX_DEPTH'] ?? 24);
const MAX_JSON_PROPERTIES = Number(
  process.env['CHART_JSON_MAX_PROPERTIES'] ?? 8_000,
);
const MAX_TABLE_ROWS = Number(process.env['CHART_TABLE_MAX_ROWS'] ?? 100);
// Any ECharts option missing ALL of these keys has no actual visualization
// content — used by hasRenderableSignal to drop empty/decorative-only
// widgets rather than shipping something that renders as a blank box.
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

export interface ChartResult {
  result: DashboardSpec;
  usage: TokenUsage;
}

/**
 * The structured-output contract the chart LLM call must satisfy. Note how
 * little this actually constrains: `option` is `z.record(z.unknown())` —
 * genuinely any object shape — because the model is authoring real ECharts
 * configuration, not filling in a fixed template. The one real structural
 * rule (superRefine below) is "every non-table widget must have a non-empty
 * option," which catches the one failure mode Zod's plain shape validation
 * can't: an empty `{}` that technically matches the type but renders nothing.
 */
const widgetSchema = z
  .object({
    type: z.string().min(1),
    title: z.string().min(1),
    insight: z.string().optional(),
    option: z.record(z.unknown()).optional(),
    columns: z.array(z.string().min(1)).optional(),
  })
  .superRefine((widget, ctx) => {
    const hasOption =
      widget.option != null && Object.keys(widget.option).length > 0;
    const isTable = widget.type.trim().toLowerCase() === 'table';
    if (!hasOption && !isTable) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'widgets must include a non-empty option object unless type="table".',
        path: ['option'],
      });
    }
  });

const dashboardSchema = z.object({
  layout: z.enum(['analytical', 'executive', 'operational']),
  summary: z.string().min(1),
  widgets: z.array(widgetSchema).min(1).max(MAX_WIDGETS),
});

type LlmWidget = z.infer<typeof widgetSchema>;
type LlmDashboard = z.infer<typeof dashboardSchema>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Deep-clones an arbitrary LLM-produced value into JSON-safe shape,
 * enforcing MAX_JSON_DEPTH/MAX_JSON_PROPERTIES as it goes. `undefined`
 * results (from exceeding a cap, or from a value type that isn't
 * JSON-representable) are dropped rather than propagated — an oversized or
 * malformed sub-tree quietly disappears from the option rather than making
 * the whole widget invalid.
 */
function sanitizeJson(
  value: unknown,
  state: { count: number },
  depth = 0,
): JsonValue | undefined {
  if (depth > MAX_JSON_DEPTH || state.count > MAX_JSON_PROPERTIES)
    return undefined;
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') {
    state.count += 1;
    return value;
  }
  if (typeof value === 'number') {
    state.count += 1;
    // NaN/Infinity aren't valid JSON — coerce to null rather than letting
    // them silently corrupt JSON.stringify downstream.
    return Number.isFinite(value) ? value : null;
  }
  if (Array.isArray(value)) {
    state.count += 1;
    const arr = value
      .map((item) => sanitizeJson(item, state, depth + 1))
      .filter((item): item is JsonValue => item !== undefined);
    return arr;
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

/** Runs a widget's raw `option` through sanitizeJson and rejects it outright if nothing survived (empty object, or not a record at all). */
function sanitizeOption(option: unknown): Record<string, unknown> | null {
  const sanitized = sanitizeJson(option, { count: 0 });
  if (!isPlainRecord(sanitized) || !Object.keys(sanitized).length) return null;
  return sanitized;
}

/** True if the option contains at least one key that ECharts would actually render something from. */
function hasRenderableSignal(option: Record<string, unknown>): boolean {
  return Object.keys(option).some((key) => RENDERABLE_OPTION_KEYS.has(key));
}

/** True if any series entry already carries its own inline `data` array (as opposed to relying on `dataset`+`encode`). */
function hasInlineSeriesData(series: unknown): boolean {
  if (!Array.isArray(series)) return false;
  return series.some((item) => isPlainRecord(item) && 'data' in item);
}

/** True if any series entry uses `encode` (the dataset-driven mapping style the SKILL.md instructions push the model toward). */
function hasSeriesEncode(series: unknown): boolean {
  if (!Array.isArray(series)) return false;
  return series.some((item) => isPlainRecord(item) && 'encode' in item);
}

/**
 * Injects the REAL, full row data into an option's `dataset.source` unless
 * it's already there. The model is explicitly told in SKILL.md it may omit
 * `dataset.source` entirely and let the runtime fill it in — this is that
 * fill-in step. For an array-form dataset (ECharts supports multiple linked
 * datasets), only the FIRST entry lacking a `source` gets the real rows;
 * subsequent entries are left as authored (they're presumably transforms of
 * the first).
 */
function normalizeDataset(
  dataset: unknown,
  rows: Record<string, unknown>[],
): unknown {
  if (Array.isArray(dataset)) {
    let injected = false;
    return dataset.map((item) => {
      if (!isPlainRecord(item)) return item;
      if (!injected && item['source'] === undefined) {
        injected = true;
        return { ...item, source: rows };
      }
      return item;
    });
  }
  if (isPlainRecord(dataset)) {
    return dataset['source'] === undefined
      ? { ...dataset, source: rows }
      : dataset;
  }
  return dataset;
}

/**
 * Decides whether/how to attach the real row data to an option that has no
 * `dataset` key at all (as opposed to normalizeDataset above, which handles
 * the case where `dataset` already exists but is missing `source`).
 * Only synthesizes a `dataset: { source: rows }` when the series looks like
 * it's expecting one — i.e. it uses `encode` OR doesn't already carry its
 * own inline `data` array. A series with genuine inline data (the model
 * deliberately hand-wrote small literal values, e.g. a fixed reference line)
 * is left completely alone.
 */
function attachDatasetSource(
  option: Record<string, unknown>,
  rows: Record<string, unknown>[],
): Record<string, unknown> {
  if ('dataset' in option) {
    return { ...option, dataset: normalizeDataset(option['dataset'], rows) };
  }

  if (
    hasSeriesEncode(option['series']) ||
    !hasInlineSeriesData(option['series'])
  ) {
    return { dataset: { source: rows }, ...option };
  }

  return option;
}

/**
 * A heatmap's color scale (`visualMap`) requires knowing the real min/max of
 * the value field being visualized — something the model can't reliably
 * compute itself from a handful of sample rows. If the widget is a heatmap
 * and doesn't already define a visualMap, this computes the actual min/max
 * across ALL rows (not just the sample the model saw) and synthesizes one.
 * Left untouched if the model already provided its own visualMap, or if
 * this isn't a heatmap at all, or if the value field can't be identified.
 */
function ensureHeatmapVisualMap(
  option: Record<string, unknown>,
  rows: Record<string, unknown>[],
): Record<string, unknown> {
  if (isPlainRecord(option['visualMap'])) return option;
  if (Array.isArray(option['visualMap']) && option['visualMap'].length)
    return option;

  const series = Array.isArray(option['series']) ? option['series'] : [];
  const heatmapSeries = series.find(
    (s): s is Record<string, unknown> =>
      isPlainRecord(s) && s['type'] === 'heatmap',
  );
  if (!heatmapSeries) return option;

  const encode = heatmapSeries['encode'];
  const valueField =
    isPlainRecord(encode) && typeof encode['value'] === 'string'
      ? encode['value']
      : undefined;
  if (!valueField) return option;

  const values = rows
    .map((row) => row[valueField])
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!values.length) return option;

  const min = Math.min(...values);
  const max = Math.max(...values);

  return {
    ...option,
    visualMap: {
      type: 'continuous',
      calculable: true,
      min,
      // Guard against a degenerate single-value dataset where min === max —
      // ECharts needs a non-zero range to render a usable color scale.
      max: max > min ? max : min + 1,
      orient: 'horizontal',
      left: 'center',
      top: 0,
    },
  };
}

/** Recursively collects every dimension name declared on a `dataset` (used by logUnknownRefs below to know what encode references are actually valid). */
function collectDatasetDimensions(
  value: unknown,
  acc = new Set<string>(),
): Set<string> {
  const readDimensions = (dataset: Record<string, unknown>) => {
    const dims = dataset['dimensions'];
    if (Array.isArray(dims)) {
      for (const dim of dims) {
        if (typeof dim === 'string' && dim.trim()) acc.add(dim.trim());
        if (
          isPlainRecord(dim) &&
          typeof dim['name'] === 'string' &&
          dim['name'].trim()
        ) {
          acc.add(dim['name'].trim());
        }
      }
    }
  };

  if (Array.isArray(value)) {
    for (const item of value) {
      if (isPlainRecord(item)) readDimensions(item);
    }
    return acc;
  }

  if (isPlainRecord(value)) readDimensions(value);
  return acc;
}

/** Recursively walks an option collecting every field name referenced by any `encode` block anywhere in it (series, visualMap, etc). */
function collectEncodeRefs(
  value: unknown,
  acc = new Set<string>(),
): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectEncodeRefs(item, acc);
    return acc;
  }

  if (!isPlainRecord(value)) return acc;

  if (isPlainRecord(value['encode'])) {
    for (const encodeValue of Object.values(value['encode'])) {
      if (typeof encodeValue === 'string' && encodeValue.trim()) {
        acc.add(encodeValue.trim());
      } else if (Array.isArray(encodeValue)) {
        for (const part of encodeValue) {
          if (typeof part === 'string' && part.trim()) acc.add(part.trim());
        }
      }
    }
  }

  for (const child of Object.values(value)) collectEncodeRefs(child, acc);
  return acc;
}

/**
 * Diagnostic-only check (never blocks or alters the widget): logs a warning
 * if any `encode` reference in the option doesn't correspond to either a
 * real row field or a declared dataset dimension — a sign the model
 * hallucinated a field name. Numeric-looking refs (encode can legitimately
 * reference a dataset column BY INDEX) are excluded from the "unknown" set.
 */
function logUnknownRefs(
  option: Record<string, unknown>,
  rowKeys: Set<string>,
  widgetTitle: string,
): void {
  const allowed = new Set([
    ...rowKeys,
    ...collectDatasetDimensions(option['dataset']),
  ]);
  const refs = [...collectEncodeRefs(option)];
  const unknown = refs.filter(
    (ref) => !allowed.has(ref) && Number.isNaN(Number(ref)),
  );
  if (unknown.length) {
    log(
      'chart',
      `widget "${widgetTitle}" references unknown encode field(s): ${unknown.join(', ')}`,
    );
  }
}

/** Builds a `table` widget (raw rows + columns) — the one widget type that skips ECharts option handling entirely. */
function buildTableWidget(
  widget: LlmWidget,
  rows: Record<string, unknown>[],
  rowKeys: Set<string>,
  id: string,
): WidgetSpec {
  // Use the model's requested columns if they're all real fields; otherwise
  // fall back to every field the rows actually have.
  const requested = widget.columns?.filter((col) => rowKeys.has(col)) ?? [];
  const columns = requested.length ? requested : [...rowKeys];

  return {
    id,
    type: 'table',
    title: widget.title,
    insight: widget.insight,
    columns,
    rows: rows
      .slice(0, MAX_TABLE_ROWS)
      .map((row) =>
        Object.fromEntries(columns.map((column) => [column, row[column]])),
      ),
  };
}

/**
 * Converts one raw LLM widget into a final WidgetSpec (or null if it should
 * be dropped entirely), running it through the full sanitize → validate →
 * hydrate pipeline: JSON-safety, renderability, dataset/visualMap injection,
 * and the unknown-field diagnostic log.
 */
function toWidgetSpec(
  widget: LlmWidget,
  rows: Record<string, unknown>[],
  rowKeys: Set<string>,
  index: number,
): WidgetSpec | null {
  const id = `w${index + 1}`;
  const normalizedType = widget.type.trim().toLowerCase();

  if (normalizedType === 'table') {
    return buildTableWidget(widget, rows, rowKeys, id);
  }

  const option = sanitizeOption(widget.option);
  if (!option) {
    log('chart', `dropped widget "${widget.title}" — invalid or empty option`);
    return null;
  }

  if (!hasRenderableSignal(option)) {
    log(
      'chart',
      `dropped widget "${widget.title}" — option has no renderable ECharts content`,
    );
    return null;
  }

  const hydrated = ensureHeatmapVisualMap(
    attachDatasetSource(option, rows),
    rows,
  );
  logUnknownRefs(hydrated, rowKeys, widget.title);

  return {
    id,
    type: widget.type,
    title: widget.title,
    insight: widget.insight,
    option: hydrated,
  };
}

/**
 * The chart skill's entry point: rows + prompt + presentation hints in,
 * a fully-hydrated DashboardSpec out. Retries the LLM call once with an
 * explicit correction if the first structured-output attempt fails
 * validation (the same one-shot-retry pattern used by the planner).
 */
export async function runChart(
  rows: Record<string, unknown>[],
  prompt: string,
  strategy?: SkillKind,
  chartHint?: ChartHint,
  source?: DataSource,
  apiKey?: string,
  userModel?: string,
  userProvider?: string,
  maxTokens?: number,
): Promise<ChartResult> {
  // No rows at all — don't even call the LLM, just return an explicit
  // "no data" dashboard with zero token cost.
  if (!rows.length) {
    return {
      result: {
        layout: 'operational',
        title: 'No data',
        summary: 'No rows returned for this request.',
        widgets: [],
      },
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  log(
    'chart',
    `rows: ${rows.length} | strategy: ${strategy ?? 'standard'} | hint: ${chartHint ?? '-'} | source: ${source?.name ?? '?'}`,
  );

  const rowKeys = new Set<string>(rows.flatMap((row) => Object.keys(row)));
  const t0 = Date.now();

  const agent = createSkillAgent(
    'chart',
    CHART_INSTRUCTIONS,
    apiKey,
    userModel,
    userProvider,
  );

  const basePrompt = buildChartPrompt(
    rows,
    prompt,
    strategy,
    chartHint,
    source,
  );

  let generateHint: string | undefined;
  let result: Awaited<ReturnType<typeof agent.generate>> | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const content = generateHint
      ? `${basePrompt}\n\nPREVIOUS ATTEMPT FAILED — ${generateHint}`
      : basePrompt;
    try {
      result = await withRateLimitRetry(
        () =>
          agent.generate([{ role: 'user', content }], {
            structuredOutput: { schema: dashboardSchema },
            modelSettings: {
              maxOutputTokens: maxTokens ?? MAX_TOKENS,
              temperature: 0,
              maxRetries: 0,
            },
            abortSignal: freshSignal('chart'),
            providerOptions: skillProviderOptions(apiKey, userProvider),
          }),
        'chart',
      );
      break;
    } catch (err) {
      // Structured-output validation failed (e.g. the model echoes the
      // "strategy" value like "overview" into the unrelated "layout" enum,
      // which only accepts analytical/executive/operational). Retry once
      // with an explicit correction instead of crashing the whole request.
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt === 0) {
        generateHint =
          `Your previous response failed output validation: ${msg}. ` +
          `Note that "layout" is a PRESENTATION style, unrelated to any "strategy" ` +
          `value mentioned above — it must be exactly one of: analytical, executive, operational.`;
        log('chart', `retrying after validation failure: ${msg}`);
        continue;
      }
      throw err;
    }
  }

  const plan = result!.object as LlmDashboard;
  const usage: TokenUsage = {
    inputTokens: result!.usage.inputTokens ?? 0,
    outputTokens: result!.usage.outputTokens ?? 0,
  };

  log(
    'chart:llm',
    `done in ${Date.now() - t0}ms | widgets: ${plan.widgets.length} | in:${usage.inputTokens} out:${usage.outputTokens}`,
  );
  logTrace('chart:llm', 'dashboard plan', plan);

  // Run every widget through the sanitize/hydrate pipeline, dropping
  // anything that came back null (invalid or unrenderable option).
  const widgets = plan.widgets
    .slice(0, MAX_WIDGETS)
    .map((widget, index) => toWidgetSpec(widget, rows, rowKeys, index))
    .filter((widget): widget is WidgetSpec => widget !== null);

  log('chart', `done | widgets: ${widgets.length} | layout: ${plan.layout}`);

  return {
    result: {
      layout: plan.layout,
      title: prompt,
      summary: plan.summary,
      widgets,
    },
    usage,
  };
}
