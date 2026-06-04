import { z } from 'zod';

const optionalString = z
  .string()
  .nullable()
  .optional()
  .transform((v) => v ?? undefined);

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

export const chartPlanSchema = z.object({
  chartType: chartTypeSchema.nullable().optional().transform((v) => v ?? undefined),
  xAxisField: optionalString,
  yAxisField: optionalString,
  groupByField: optionalString,
  title: optionalString,
});

export type ChartType = z.infer<typeof chartTypeSchema>;
export type ChartResult = z.infer<typeof chartResultSchema>;
export type ChartPlan = z.infer<typeof chartPlanSchema>;
