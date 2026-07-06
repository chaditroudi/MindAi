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

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

const CHART_INSTRUCTIONS = readMarkdownSection(
  skillFile('chart', 'SKILL.md'),
  'System Instructions',
);

const MAX_WIDGETS = Number(process.env['CHART_MAX_WIDGETS'] ?? 4);
const MAX_TOKENS = Number(process.env['CHART_MAX_TOKENS'] ?? 2_000);
const MAX_JSON_PROPERTIES = Number(
  process.env['CHART_JSON_MAX_PROPERTIES'] ?? 8_000,
);
const MAX_JSON_DEPTH = Number(process.env['CHART_JSON_MAX_DEPTH'] ?? 20);
const MAX_TABLE_ROWS = Number(process.env['CHART_TABLE_MAX_ROWS'] ?? 100);
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

function sanitizeOption(option: unknown): Record<string, unknown> | null {
  const sanitized = sanitizeJson(option, { count: 0 });
  if (!isPlainRecord(sanitized) || !Object.keys(sanitized).length) return null;
  return sanitized;
}

function hasRenderableSignal(option: Record<string, unknown>): boolean {
  return Object.keys(option).some((key) => RENDERABLE_OPTION_KEYS.has(key));
}

function hasInlineSeriesData(series: unknown): boolean {
  if (!Array.isArray(series)) return false;
  return series.some((item) => isPlainRecord(item) && 'data' in item);
}

function hasSeriesEncode(series: unknown): boolean {
  if (!Array.isArray(series)) return false;
  return series.some((item) => isPlainRecord(item) && 'encode' in item);
}

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

function attachDatasetSource(
  option: Record<string, unknown>,
  rows: Record<string, unknown>[],
): Record<string, unknown> {
  if ('dataset' in option) {
    return { ...option, dataset: normalizeDataset(option['dataset'], rows) };
  }

  return { dataset: { source: rows }, ...option };
}

// ---------------------------------------------------------------------------
// Category aggregation safety net
//
// Why this exists: the chart LLM is asked (see skills/chart/SKILL.md) to
// group record-level rows itself before charting them "by category". It
// usually does, but not always — a model can map a bar/pie series straight
// onto ungrouped rows, producing a chart whose bars/slices are individual
// records instead of category totals (wrong numbers, duplicate axis labels).
// A better prompt lowers how often that happens; it can never make it
// impossible, since prompt-following is probabilistic, not guaranteed.
//
// This block is the deterministic correction underneath the prompt: it reads
// whichever fields the model chose to encode (no hardcoded field names), and
// only steps in if it finds more than one row per category — i.e. it is a
// mathematically exact no-op whenever the model (or an upstream $group
// stage) already produced correctly aggregated data. It never overrides a
// correct chart; it only fixes an incorrect one.
// ---------------------------------------------------------------------------

function extractCategoryValueFields(series: unknown): {
  categoryField: string | null;
  valueFields: Set<string>;
} {
  const categoryFields: string[] = [];
  const valueFields = new Set<string>();
  if (!Array.isArray(series)) return { categoryField: null, valueFields };

  for (const item of series) {
    if (!isPlainRecord(item)) continue;
    const type = typeof item['type'] === 'string' ? item['type'] : '';
    if (type !== 'bar' && type !== 'pie') continue;
    const encode = item['encode'];
    if (!isPlainRecord(encode)) continue;

    const category = type === 'pie' ? encode['itemName'] : encode['x'];
    const value = type === 'pie' ? encode['value'] : encode['y'];

    if (typeof category === 'string' && category.trim()) {
      categoryFields.push(category);
    }
    if (typeof value === 'string' && value.trim()) {
      valueFields.add(value);
    } else if (Array.isArray(value)) {
      for (const v of value) if (typeof v === 'string') valueFields.add(v);
    }
  }

  return { categoryField: categoryFields[0] ?? null, valueFields };
}

function hasDuplicateCategoryValues(
  source: Record<string, unknown>[],
  categoryField: string,
): boolean {
  const seen = new Set<string>();
  for (const row of source) {
    const key = String(row[categoryField]);
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

function aggregateByCategory(
  source: Record<string, unknown>[],
  categoryField: string,
  valueFields: Set<string>,
): Record<string, unknown>[] {
  const groups = new Map<
    string,
    {
      category: unknown;
      count: number;
      sums: Map<string, number>;
      hasNumeric: Map<string, boolean>;
    }
  >();

  for (const row of source) {
    const category = row[categoryField];
    const key = String(category);
    let group = groups.get(key);
    if (!group) {
      group = { category, count: 0, sums: new Map(), hasNumeric: new Map() };
      groups.set(key, group);
    }
    group.count += 1;
    for (const field of valueFields) {
      const raw = row[field];
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        group.sums.set(field, (group.sums.get(field) ?? 0) + raw);
        group.hasNumeric.set(field, true);
      }
    }
  }

  return [...groups.values()].map((group) => {
    const out: Record<string, unknown> = { [categoryField]: group.category };
    for (const field of valueFields) {
      out[field] = group.hasNumeric.get(field)
        ? (group.sums.get(field) ?? 0)
        : group.count;
    }
    return out;
  });
}

function aggregateCategoricalSeriesData(
  option: Record<string, unknown>,
  widgetTitle: string,
): Record<string, unknown> {
  const dataset = option['dataset'];
  const source = isPlainRecord(dataset) ? dataset['source'] : undefined;
  if (!Array.isArray(source) || !source.every(isPlainRecord)) return option;

  const { categoryField, valueFields } = extractCategoryValueFields(
    option['series'],
  );
  if (!categoryField || !valueFields.size) return option;
  if (!hasDuplicateCategoryValues(source, categoryField)) return option;

  const grouped = aggregateByCategory(
    source as Record<string, unknown>[],
    categoryField,
    valueFields,
  );

  log(
    'chart',
    `widget "${widgetTitle}" — grouped ${source.length} row(s) into ` +
      `${grouped.length} categor${grouped.length === 1 ? 'y' : 'ies'} by ` +
      `"${categoryField}" for correct bar/pie totals`,
  );

  return {
    ...option,
    dataset: { ...(dataset as Record<string, unknown>), source: grouped },
  };
}

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
      max: max > min ? max : min + 1,
      orient: 'horizontal',
      left: 'center',
      top: 0,
    },
  };
}

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

function logUnknownRefs(
  option: Record<string, unknown>,
  rowKeys: Set<string>,
  widgetTitle: string,
): void {
  const allowed = new Set([
    ...rowKeys,
    ...collectDatasetDimensions(option['dataset']),
  ]);

  // `encode` only ever appears in chart config (series/visualMap), never
  const { dataset: _dataset, ...configOnly } = option;
  const refs = [...collectEncodeRefs(configOnly)];
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

function buildTableWidget(
  widget: LlmWidget,
  rows: Record<string, unknown>[],
  rowKeys: Set<string>,
  id: string,
): WidgetSpec {
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

  if (
    !hasSeriesEncode(option['series']) &&
    hasInlineSeriesData(option['series'])
  ) {
    log(
      'chart',
      `widget "${widget.title}" authored inline series data with no dataset/encode — ` +
        `these values come from the LLM directly and are not verified against the query rows`,
    );
  }

  const hydrated = ensureHeatmapVisualMap(
    aggregateCategoricalSeriesData(
      attachDatasetSource(option, rows),
      widget.title,
    ),
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
