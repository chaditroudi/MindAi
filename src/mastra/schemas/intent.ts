import { z } from 'zod';

export const intentKindSchema = z.enum(['general_question', 'report', 'dashboard']);

export const taskPlanSchema = z.object({
  intent: intentKindSchema,
  needsData: z.boolean(),
  needsEnrichment: z.boolean(),
  needsChart: z.boolean(),
  query: z.object({
    blueprintId: z.string().optional(),
    dataStoreName: z.string().optional(),
    metric: z.string().optional(),
    aggregation: z.enum(['sum', 'avg', 'count', 'min', 'max']).optional(),
    dimensions: z.array(z.string()).optional(),
    timeRange: z
      .object({
        field: z.string(),
        from: z.string().optional(),
        to: z.string().optional(),
      })
      .optional(),
    filters: z
      .array(
        z.object({
          field: z.string(),
          op: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in']),
          value: z.unknown(),
        }),
      )
      .optional(),
    sort: z.array(z.object({ field: z.string(), dir: z.enum(['asc', 'desc']) })).optional(),
    limit: z.number().int().positive().optional(),
  }),
  enrichment: z
    .object({
      topic: z.string(),
      dimensions: z.array(z.string()),
      sources: z.array(z.string()).optional(),
    })
    .optional(),
  chartHint: z.enum(['compare', 'trend', 'distribution', 'part_of_whole', 'geo']).optional(),
});

export type TaskPlanInput = z.infer<typeof taskPlanSchema>;

export const datasetSchema = z.object({
  rows: z.array(z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]))),
  schema: z.record(z.string()),
  source: z.enum(['mongodb', 'search', 'merged']),
  citations: z
    .array(
      z.object({
        title: z.string(),
        url: z.string().optional(),
        snippet: z.string().optional(),
      }),
    )
    .optional(),
});
