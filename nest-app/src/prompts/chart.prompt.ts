import { interpolateTemplate, readMarkdownSection, skillFile } from '../ai/skill-prompt';
import type { DataSource, SkillKind, ChartHint } from '../types';

const INSTRUCTIONS = readMarkdownSection(skillFile('chart', 'SKILL.md'), 'Runtime Prompt');

const PROFILE_ROWS = Number(process.env['CHART_PROFILE_ROWS'] ?? 10);
const SAMPLE_ROWS  = Number(process.env['CHART_SAMPLE_ROWS']  ?? 8);

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
  const values: Record<string, string> = {
    '{{USER_REQUEST}}': prompt,
    '{{STRATEGY}}':     strategy  ?? 'standard',
    '{{CHART_HINT}}':   chartHint ?? 'none',
    '{{ROW_COUNT}}':    String(rows.length),
    '{{COLUMNS}}':      JSON.stringify(profileColumns(rows, source), null, 2),
    '{{SAMPLE_ROWS}}':  JSON.stringify(rows.slice(0, SAMPLE_ROWS), null, 2),
  };

  const base = interpolateTemplate(INSTRUCTIONS, values);

  if (source?.suggestedCharts?.length) {
    const hints = source.suggestedCharts.map(({ pipeline: _p, ...rest }) => rest);
    return (
      `SUGGESTED CHARTS FOR THIS DATA SOURCE (use as reference for type and field mapping):\n` +
      `${JSON.stringify(hints, null, 2)}\n\n` +
      base
    );
  }

  return base;
}
