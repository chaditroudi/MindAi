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
  option: z.record(z.any()),
  title: z.string(),
  annotations: z.array(z.string()).optional(),
  accessibility: z.object({
    description: z.string(),
  }),
});

export type ChartType = z.infer<typeof chartTypeSchema>;
export type ChartResult = z.infer<typeof chartResultSchema>;