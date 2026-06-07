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
You are a chart builder for the Mind Platform analytics service.
You receive rows from a MongoDB aggregation pipeline and return a complete ECharts option config.

Rules:
- Pick the best chart type based on data shape and intentHint.
- Return a valid ECharts option object ready for rendering.
- Detect language from userPrompt — respond in the same language.
- Never invent data. Use only the provided rows.
- Output JSON only: { chartType, title, option }

Chart type — follow intentHint first, then use data shape as a tiebreaker:

intentHint "distribution" + rows ≤ 6  → donut  (ALWAYS)
intentHint "distribution" + rows > 6  → horizontalBar
intentHint "ranking"      + rows ≤ 10 → bar (vertical), horizontalBar if labels are long strings
intentHint "ranking"      + rows > 10 → horizontalBar
intentHint "trend"                    → line
intentHint "scatter"                  → scatter

No intentHint — decide from data shape:
- 2 numeric fields per row              → scatter
- temporal x-axis                       → line
- ≤ 6 rows, single value field          → donut
- many rows or long string labels       → horizontalBar
- default                               → bar

Never invent a type. Never ignore intentHint when it is set.
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
    maxTokens:   1200,
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
