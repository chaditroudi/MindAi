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

Chart type guidance (pick what best fits the actual data shape):
- trend / temporal series        → line
- few ranked categories (≤ 10)   → bar (vertical) or horizontalBar if labels are long
- many categories (> 10)         → horizontalBar
- part of whole (≤ 6 slices)     → donut
- distribution of values         → histogram
- geo / location data            → map
- correlation of 2 numeric fields → scatter
- default                        → bar

Always look at the actual rows first. If the data has long string labels, prefer horizontalBar.
If it has short labels or numbers, prefer bar. Never force a type — choose what renders best.
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
