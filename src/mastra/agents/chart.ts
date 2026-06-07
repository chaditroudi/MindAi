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
You are a chart builder. You receive MongoDB aggregation rows and must return a fully working ECharts option object.

STEP 1 — Inspect the rows:
- Look at the first row to identify all field names and their types (string, number, date).
- The string field is almost always the label/category axis.
- The number field(s) are the values to plot.
- Row count matters: few rows → donut or bar, many rows → horizontalBar or line.

STEP 2 — Choose the right chart type based on what the data actually looks like:
- 1 string field + 1 number field + few rows (≤ 8)  → donut
- 1 string field + 1 number field + more rows        → bar or horizontalBar
- 1 date/year field + 1 number field                 → line
- 2 number fields per row                            → scatter
- 1 string field + multiple number fields            → bar with multiple series
- Use horizontalBar when label strings are long (> 10 chars average)

STEP 3 — Build the ECharts option using ONLY real field values from the rows:

For bar / horizontalBar:
{
  "xAxis": { "type": "category", "data": [<string field values>] },
  "yAxis": { "type": "value" },
  "series": [{ "type": "bar", "data": [<number field values in same order>] }],
  "tooltip": { "trigger": "axis" },
  "grid": { "containLabel": true }
}
(For horizontalBar swap xAxis↔yAxis types and set series type to "bar" with orient implicit from axis swap)

For donut:
{
  "series": [{
    "type": "pie",
    "radius": ["40%", "70%"],
    "data": [{ "name": <string field>, "value": <number field> }, ...]
  }],
  "tooltip": { "trigger": "item" },
  "legend": { "orient": "vertical", "left": "left" }
}

For line:
{
  "xAxis": { "type": "category", "data": [<date/year values>] },
  "yAxis": { "type": "value" },
  "series": [{ "type": "line", "data": [<number values>], "smooth": true }],
  "tooltip": { "trigger": "axis" }
}

For scatter:
{
  "xAxis": { "type": "value", "name": "<field1 name>" },
  "yAxis": { "type": "value", "name": "<field2 name>" },
  "series": [{ "type": "scatter", "data": [[x1,y1],[x2,y2],...] }],
  "tooltip": { "trigger": "item" }
}

RULES:
- Every value in option must come directly from the rows. No invented data.
- Always include tooltip and grid (for axis charts).
- Detect language from userPrompt — title must be in that language.
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
