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

Your job:
1. Read the actual rows carefully — look at field names, value types, and row count.
2. Choose the chart type that best visualises that specific data. Trust your own judgment.
3. Build a complete, valid ECharts option object. Every axis, series, legend, and tooltip must be populated from real values.
4. Title must be concise and descriptive of what the chart shows.
5. Detect the language from userPrompt and respond in that language.
6. Never invent data points. Every value in option must come from the rows.

You may use: bar, horizontalBar, line, donut, scatter, histogram, map, table.
Pick freely — there is no forced mapping. The best chart is the one that makes the data immediately readable.
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
