import { z } from 'zod';

export const chartTypeSchema = z.enum([
  'line',
  'bar',
  'horizontalBar',
  'scatter',
  'donut',
  'map',
  'histogram',
  'table',
]);

export const chartResultSchema = z.object({
  chartType: chartTypeSchema,
  option: z.record(z.unknown()), // raw ECharts option
  title: z.string(),
  annotations: z.array(z.string()).optional(),
  accessibility: z.object({ description: z.string() }),
});

export type ChartResultInput = z.infer<typeof chartResultSchema>;
