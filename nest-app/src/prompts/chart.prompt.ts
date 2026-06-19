import { interpolateTemplate, readMarkdownSection, skillFile } from '../ai/skill-prompt';
import type { DataSource, SkillKind, ChartHint } from '../types';

const INSTRUCTIONS = readMarkdownSection(skillFile('chart', 'SKILL.md'), 'Runtime Prompt');

const MAX_ROWS = Number(process.env['CHART_MAX_ROWS'] ?? 100);

export function buildChartPrompt(
  rows:       Record<string, unknown>[],
  prompt:     string,
  strategy?:  SkillKind,
  chartHint?: ChartHint,
  source?:    DataSource,
): string {
  const cappedRows = rows.slice(0, MAX_ROWS);

  const values: Record<string, string> = {
    '{{USER_REQUEST}}': prompt,
    '{{STRATEGY}}':     strategy  ?? 'standard',
    '{{CHART_HINT}}':   chartHint ?? 'none',
    '{{ROW_COUNT}}':    String(rows.length),
    '{{DATA_ROWS}}':    JSON.stringify(cappedRows, null, 2),
  };

  const base = interpolateTemplate(INSTRUCTIONS, values);

  if (source?.suggestedCharts?.length) {
    const hints = source.suggestedCharts.map(({ pipeline: _p, ...rest }) => rest);
    return (
      `SUGGESTED CHARTS FOR THIS DATA SOURCE (use as reference for type and field intent):\n` +
      `${JSON.stringify(hints, null, 2)}\n\n` +
      base
    );
  }

  return base;
}
