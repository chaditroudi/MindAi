import { z } from 'zod';

export const intentKindSchema = z.enum(['general_question', 'report', 'dashboard']);

const sortDirectionSchema = z.enum(['asc', 'desc']);
const nullToUndefined = (value: unknown) => value === null ? undefined : value;
const objectOrUndefined = (value: unknown) =>
  value === null || typeof value !== 'object' || Array.isArray(value) ? undefined : value;
const positiveIntOrUndefined = (value: unknown) => {
  if (value === null || value === undefined) return undefined;
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isInteger(numeric) || numeric <= 0) return undefined;
  return numeric;
};
const optionalString = z.preprocess(nullToUndefined, z.string().optional());
const optionalStringArray = z.preprocess(nullToUndefined, z.array(z.string()).optional());
const optionalPositiveInt = z.preprocess(positiveIntOrUndefined, z.number().int().positive().optional());

type SortClause = { field: string; dir: 'asc' | 'desc' };

const sortClauseSchema: z.ZodType<SortClause, z.ZodTypeDef, unknown> = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;

  const sort = value as { field?: unknown; dir?: unknown; direction?: unknown };
  return {
    field: sort.field,
    dir: sort.dir ?? sort.direction,
  };
}, z.object({ field: z.string(), dir: sortDirectionSchema }));

export const taskPlanSchema = z.object({
  intent: intentKindSchema,
  needsData: z.boolean(),
  needsEnrichment: z.boolean(),
  needsChart: z.boolean(),
  query: z.object({
    blueprintId: optionalString,
    dataStoreId: optionalString,
    dataStoreName: optionalString,
    metric: optionalString,
    metrics: optionalStringArray,
    aggregation: z.preprocess(nullToUndefined, z.enum(['sum', 'avg', 'count', 'min', 'max']).optional()),
    dimensions: optionalStringArray,
    topN: optionalPositiveInt,
    percentOf: optionalString,
    having: z.preprocess(nullToUndefined, z
      .object({
        field: z.string(),
        op: z.enum(['gt', 'gte', 'lt', 'lte', 'eq']),
        value: z.number(),
      })
      .optional()),
    lookups: z.preprocess(nullToUndefined, z
      .array(
        z.object({
          from: z.string(),
          localField: z.string(),
          foreignField: z.string(),
          as: z.string(),
        }),
      )
      .optional()),
    timeRange: z.preprocess(objectOrUndefined, z
      .object({
        field: z.string(),
        from: optionalString,
        to: optionalString,
      })
      .optional()),
    filters: z.preprocess(nullToUndefined, z
      .array(
        z.object({
          field: z.string(),
          op: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'regex']),
          value: z.unknown(),
        }),
      )
      .optional()),
    sort: z.preprocess(nullToUndefined, z.array(sortClauseSchema).optional()),
    limit: optionalPositiveInt,
  }),
  enrichment: z.preprocess(nullToUndefined, z
    .object({
      topic: z.string(),
      dimensions: z.array(z.string()),
      timeRange: z.preprocess(objectOrUndefined, z
        .object({
          field: z.string(),
          from: optionalString,
          to: optionalString,
        })
        .optional()),
      language: optionalString,
      locale: optionalString,
      sources: optionalStringArray,
    })
    .optional()),
  chartHint: z.preprocess(nullToUndefined, z
    .enum(['compare', 'trend', 'distribution', 'part_of_whole', 'geo', 'ranking'])
    .optional()),
});

export type TaskPlanInput = z.infer<typeof taskPlanSchema>;

export const datasetSchema = z.object({
  rows: z.array(z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]))),
  schema: z.record(z.string()),
  jsonSchema: z.record(z.unknown()).optional(),
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
