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

/**
 * Structured output contract for the ChartPlannerAgent.
 * Contains field assignments only — never data values.
 * The deterministic chart builder consumes this and owns all rendering.
 */
export const chartPlanSchema = z.object({
  chartType: chartTypeSchema.optional(),
  xAxisField: z.string().optional(),
  yAxisField: z.string().optional(),
  groupByField: z.string().optional(),
  title: z.string().optional(),
});

export type ChartType = z.infer<typeof chartTypeSchema>;
export type ChartResult = z.infer<typeof chartResultSchema>;
export type ChartPlan = z.infer<typeof chartPlanSchema>;