import { generateObject } from 'ai';
import { z } from 'zod';
import { resolveModel } from '../model.js';
import { log } from '../../utils/logger.js';

export const chartResultSchema = z.object({
  chartType: z.enum(['bar', 'horizontalBar', 'line', 'donut', 'scatter', 'histogram', 'map', 'table']),
  title:     z.string(),
  option:    z.record(z.unknown()),
});

export type ChartResult = z.infer<typeof chartResultSchema>;

const INSTRUCTIONS = `
You are a chart builder. You receive MongoDB rows and return a complete ECharts option object.

THE ROWS FOLLOW A STANDARD PROJECTION. Read the first row to identify the pattern:

Pattern A — { label, value }
  Single metric per category. Examples: revenue per studio, films per genre, avg rating per director.
  Choose: donut (<=6 rows), bar (7-12 rows, short labels), horizontalBar (>12 rows OR avg label length >12 chars)

Pattern B — { year, value } or { month, value }
  Time series. Values over time.
  Always: line chart

Pattern C — { label, x, y }
  Two numeric metrics per item. Correlation or comparison.
  Always: scatter chart. x-axis = x field, y-axis = y field, tooltip shows label.

Pattern D — raw fields (title, genre, revenue, rating, ...)
  Detailed list with multiple fields.
  Use table or horizontalBar depending on field count.

USE intentHint as additional context (not a command):
  ranking       -> bar or horizontalBar sorted descending
  distribution  -> donut if <=6, horizontalBar if more
  trend         -> line
  part_of_whole -> donut
  compare       -> bar with multiple series or scatter
  scatter       -> scatter

─────────────────────────────────────────────────────────────
ECHARTS OPTION TEMPLATES — fill with REAL values from rows:

BAR (vertical, short labels, 7-12 rows):
{
  "tooltip": { "trigger": "axis" },
  "grid": { "containLabel": true },
  "xAxis": { "type": "category", "data": ["<label1>", "<label2>", ...] },
  "yAxis": { "type": "value" },
  "series": [{ "type": "bar", "data": [<value1>, <value2>, ...], "itemStyle": { "borderRadius": 4 } }]
}

HORIZONTAL BAR (long labels or many rows):
{
  "tooltip": { "trigger": "axis" },
  "grid": { "containLabel": true, "left": "20%" },
  "xAxis": { "type": "value" },
  "yAxis": { "type": "category", "data": ["<label1>", "<label2>", ...] },
  "series": [{ "type": "bar", "data": [<value1>, <value2>, ...] }]
}

DONUT (<=6 categories, part-of-whole or distribution):
{
  "tooltip": { "trigger": "item", "formatter": "{b}: {c} ({d}%)" },
  "legend": { "orient": "vertical", "left": "left" },
  "series": [{
    "type": "pie",
    "radius": ["40%", "70%"],
    "avoidLabelOverlap": true,
    "data": [
      { "name": "<label1>", "value": <value1> },
      { "name": "<label2>", "value": <value2> }
    ]
  }]
}

LINE (time series — year/month as x axis):
{
  "tooltip": { "trigger": "axis" },
  "xAxis": { "type": "category", "data": ["<year1>", "<year2>", ...] },
  "yAxis": { "type": "value" },
  "series": [{ "type": "line", "data": [<value1>, <value2>, ...], "smooth": true, "areaStyle": {} }]
}

SCATTER (two numeric fields — Pattern C):
{
  "tooltip": { "trigger": "item", "formatter": "{b}" },
  "xAxis": { "type": "value", "name": "Budget (M$)" },
  "yAxis": { "type": "value", "name": "Revenue (M$)" },
  "series": [{
    "type": "scatter",
    "symbolSize": 12,
    "data": [
      { "name": "<label1>", "value": [<x1>, <y1>] },
      { "name": "<label2>", "value": [<x2>, <y2>] }
    ]
  }]
}

─────────────────────────────────────────────────────────────
RULES:
- Every number and label in option MUST come from the actual rows. Never invent data.
- Always include tooltip. Always include grid for axis-based charts.
- Title: concise, descriptive, in the same language as userPrompt.
- Output JSON only: { chartType, title, option }
`;

export async function runChartAgent({
  rows,
  prompt,
  intentHint,
}: {
  rows:        unknown[];
  prompt:      string;
  intentHint?: string;
}) {
  log('chart-agent', `LLM call | rows: ${rows.length} | intentHint: ${intentHint ?? '-'}`);

  const { object } = await generateObject({
    model:       resolveModel('chart'),
    schema:      chartResultSchema,
    temperature: 0,
    maxTokens:   2000,
    system:      INSTRUCTIONS,
    messages: [{
      role:    'user',
      content: JSON.stringify({
        rows:       rows.slice(0, 50),
        userPrompt: prompt,
        intentHint: intentHint ?? null,
      }),
    }],
  });

  log('chart-agent', `done | chartType: ${object.chartType} | title: "${object.title}"`);
  return object;
}
