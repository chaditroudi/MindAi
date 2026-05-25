import { z } from 'zod';

const nullToUndefined = (value: unknown) => value === null ? undefined : value;
const optionalString = z.preprocess(nullToUndefined, z.string().optional());

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
  chartType: z.preprocess(nullToUndefined, chartTypeSchema.optional()),
  xAxisField: optionalString,
  yAxisField: optionalString,
  groupByField: optionalString,
  clusters: z.preprocess(nullToUndefined, z.array(z.string()).optional()),
  title: optionalString,
});

export type ChartType = z.infer<typeof chartTypeSchema>;
export type ChartResult = z.infer<typeof chartResultSchema>;
export type ChartPlan = z.infer<typeof chartPlanSchema>;
