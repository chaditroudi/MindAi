import { z } from 'zod';

export const intentKindSchema = z.enum(['general_question', 'report', 'dashboard']);

export const taskPlanSchema = z.object({
  intent: intentKindSchema,
  needsData: z.boolean(),
  needsEnrichment: z.boolean(),
  needsChart: z.boolean(),
  query: z.object({
    dataStoreName: z.string().optional(),
    metric: z.string().optional(),
    metrics: z.array(z.string()).optional(),
    aggregation: z.enum(['sum', 'avg', 'count', 'min', 'max']).optional(),
    dimensions: z.array(z.string()).optional(),
    topN: z.number().int().positive().optional(),
    percentOf: z.string().optional(),
    having: z
      .object({
        field: z.string(),
        op: z.enum(['gt', 'gte', 'lt', 'lte', 'eq']),
        value: z.number(),
      })
      .optional(),
    lookups: z
      .array(
        z.object({
          from: z.string(),
          localField: z.string(),
          foreignField: z.string(),
          as: z.string(),
        }),
      )
      .optional(),
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
          op: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'regex']),
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
  chartHint: z
    .enum(['compare', 'trend', 'distribution', 'part_of_whole', 'geo', 'ranking'])
    .optional(),
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
