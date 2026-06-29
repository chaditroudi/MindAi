import { interpolateTemplate, readMarkdownSection, skillFile } from '../ai/skill-prompt';
import type { DataSource, SkillKind, ChartHint } from '../types';

const INSTRUCTIONS = readMarkdownSection(skillFile('chart', 'SKILL.md'), 'Runtime Prompt');

const PROFILE_ROWS       = Number(process.env['CHART_PROFILE_ROWS'] ?? 16);
const SAMPLE_ROWS        = Number(process.env['CHART_SAMPLE_ROWS'] ?? 12);
const CHART_DATA_MAX_ROWS  = Number(process.env['CHART_DATA_MAX_ROWS'] ?? 120);
const CHART_DATA_MAX_CHARS = Number(process.env['CHART_DATA_MAX_CHARS'] ?? 30_000);
const CHART_STYLE_CONTEXT = process.env['CHART_STYLE_CONTEXT']
  ?? [
    'Prefer dashboard-ready options with transparent backgrounds and readable spacing.',
    'Prefer dataset + encode structures when possible so runtime data can be injected dynamically.',
    'Use concise titles, readable legends, and tooltips that help interpretation without clutter.',
    'Avoid exotic animation or decorative noise unless the user explicitly asks for it.',
  ].join(' ');

function profileColumns(rows: Record<string, unknown>[], source?: DataSource) {
  const keys   = new Set<string>();
  const sample = rows.slice(0, PROFILE_ROWS);
  for (const r of sample) for (const k of Object.keys(r)) keys.add(k);

  return [...keys].map(k => {
    const values   = sample.map(r => r[k]).filter(v => v != null);
    const distinct = new Set(values.map(v => String(v)));
    const schema   = source?.fields.find(f => f.name.toLowerCase() === k.toLowerCase());
    return {
      name:          k,
      sampleValues:  [...distinct].slice(0, 5),
      distinctCount: distinct.size,
      jsType:        values.length ? typeof values[0] : 'unknown',
      ...(schema && { schemaType: schema.type, schemaRole: schema.role }),
    };
  });
}

export function buildChartPrompt(
  rows:       Record<string, unknown>[],
  prompt:     string,
  strategy?:  SkillKind,
  chartHint?: ChartHint,
  source?:    DataSource,
): string {
  const dataRows = dataBlock('DATA ROWS', rows, CHART_DATA_MAX_ROWS, CHART_DATA_MAX_CHARS);
  const values: Record<string, string> = {
    '{{USER_REQUEST}}': prompt,
    '{{STRATEGY}}':     strategy  ?? 'standard',
    '{{CHART_HINT}}':   chartHint ?? 'none',
    '{{ROW_COUNT}}':    String(rows.length),
    '{{SOURCE_NAME}}':  source?.name ?? 'unknown',
    '{{SOURCE_DESCRIPTION}}': source?.description ?? 'No source description provided.',
    '{{COLUMNS}}':      JSON.stringify(profileColumns(rows, source), null, 2),
    '{{SAMPLE_ROWS}}':  JSON.stringify(rows.slice(0, SAMPLE_ROWS), null, 2),
    '{{DATA_ROWS}}':    dataRows,
    '{{STYLING_CONTEXT}}': CHART_STYLE_CONTEXT,
  };

  const base = interpolateTemplate(INSTRUCTIONS, values);

  if (source?.suggestedCharts?.length) {
    const hints = source.suggestedCharts.map(({ pipeline: _p, ...rest }) => rest);
    return (
      `SUGGESTED CHARTS FOR THIS DATA SOURCE (use as domain reference, not as a fixed template):\n` +
      `${JSON.stringify(hints, null, 2)}\n\n` +
      base
    );
  }

  return base;
}

export function serializeRows(
  rows:     unknown[],
  maxChars: number,
): { json: string; included: number; truncated: boolean } {
  const parts: string[] = [];
  let size = 2;
  for (const row of rows) {
    const piece = JSON.stringify(row) ?? 'null';
    const cost  = piece.length + (parts.length > 0 ? 1 : 0);
    if (size + cost > maxChars) break;
    parts.push(piece);
    size += cost;
  }
  return { json: `[${parts.join(',')}]`, included: parts.length, truncated: parts.length < rows.length };
}

export function dataBlock(
  label:    string,
  rows:     unknown[],
  maxRows:  number,
  maxChars: number,
): string {
  const capped = maxRows === Infinity ? rows : rows.slice(0, maxRows);
  const { json, included, truncated } = serializeRows(capped, maxChars);
  const note = truncated || rows.length > maxRows
    ? ` (showing ${included} of ${rows.length} rows — TRUNCATED)`
    : ` (${rows.length} rows, complete)`;
  return `${label}${note}:\n${json}`;
}

export function buildInquiryMessage(prompt: string, rows: unknown[], maxRows: number, maxChars: number): string {
  return `Question: ${prompt}\n\n${dataBlock('Records', rows, maxRows, maxChars)}`;
}

export function buildReportMessage(prompt: string, rows: unknown[], maxChars: number, withChart?: boolean): string {
  const chartHint = withChart
    ? '\n\nCONTEXT: A visualization chart will be displayed alongside this report. Do NOT describe distributions or rankings in prose — the chart already shows those visually. Instead focus your sections on insights, context, comparisons, and recommendations that the chart cannot convey.'
    : '';
  return `Prompt: ${prompt}${chartHint}\n\n${dataBlock('Dataset', rows, Infinity, maxChars)}`;
}
