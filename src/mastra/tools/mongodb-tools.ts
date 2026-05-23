import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getMongo } from '../../db/mongo.client.js';
import { dataStoreRepo } from '../../db/datastore.repository.js';
import { dataStoreSchema, permissionScopeSchema } from '../schemas/datastore.js';
import { taskPlanSchema } from '../schemas/intent.js';

export const resolveDataStoreTool = createTool({
  id: 'resolve-data-store',
  description:
    'Look up accessible Data Stores and their typed fields so you know what is queryable.',
  inputSchema: z.object({
    dataStoreName: z.string().optional(),
    scope: permissionScopeSchema,
  }),
  outputSchema: z.object({
    dataStores: z.array(dataStoreSchema),
  }),
  execute: async ({ context }) => {
    const dataStores = await dataStoreRepo.listAccessibleDataStores(context.scope);
    if (context.dataStoreName) {
      const normalized = normalizeToken(context.dataStoreName);
      return {
        dataStores: dataStores.filter(
          (ds) =>
            normalizeToken(ds.name) === normalized ||
            normalizeToken(ds.collection) === normalized,
        ),
      };
    }
    return { dataStores };
  },
});

export const buildAggregationTool = createTool({
  id: 'build-aggregation',
  description:
    'Translate a structured query plan into a MongoDB aggregation pipeline. Returns the pipeline as a JSON array without executing it. Supports topN, having, lookups, multi-metric, percentOf, nin, and regex.',
  inputSchema: z.object({
    plan: taskPlanSchema,
    dataStore: dataStoreSchema,
    scope: permissionScopeSchema,
  }),
  outputSchema: z.object({
    pipeline: z.array(z.record(z.unknown())),
    collection: z.string(),
  }),
  execute: async ({ context }) => buildAggregationFromPlan(context),
});

export const executePipelineTool = createTool({
  id: 'execute-pipeline',
  description: 'Execute a MongoDB aggregation pipeline produced by build-aggregation.',
  inputSchema: z.object({
    pipeline: z.array(z.record(z.unknown())),
    collection: z.string(),
    scope: permissionScopeSchema,
  }),
  outputSchema: z.object({
    rows: z.array(z.record(z.unknown())),
    rowCount: z.number(),
  }),
  execute: async ({ context }) => executePipeline(context),
});

export const validateRowsTool = createTool({
  id: 'validate-rows',
  description: 'Validate rows shape and produce a field→type schema for downstream agents.',
  inputSchema: z.object({
    rows: z.array(z.record(z.unknown())),
    dataStore: dataStoreSchema,
  }),
  outputSchema: z.object({
    valid: z.boolean(),
    schema: z.record(z.string()),
    rows: z.array(z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]))),
    issues: z.array(z.string()),
  }),
  execute: async ({ context }) => validateRows(context),
});

export function buildAggregationFromPlan({
  plan,
  dataStore,
  scope,
}: {
  plan: z.infer<typeof taskPlanSchema>;
  dataStore: z.infer<typeof dataStoreSchema>;
  scope: z.infer<typeof permissionScopeSchema>;
}) {
  const pipeline: Record<string, unknown>[] = [];
  const filterOpMap: Record<string, string> = {
    eq: '$eq', ne: '$ne', gt: '$gt', gte: '$gte', lt: '$lt', lte: '$lte',
    in: '$in', nin: '$nin',
  };

  // 1. Tenant guard + rowFilter + user filters + time range
  const matchStage: Record<string, unknown> = { tenantId: scope.tenantId };
  if (scope.rowFilter) Object.assign(matchStage, scope.rowFilter);

  if (plan.query.filters) {
    for (const f of plan.query.filters) {
      if (f.op === 'regex') {
        matchStage[f.field] = { $regex: f.value, $options: 'i' };
      } else {
        matchStage[f.field] = { [filterOpMap[f.op]]: f.value };
      }
    }
  }

  if (plan.query.timeRange) {
    const range: Record<string, unknown> = {};
    if (plan.query.timeRange.from) range.$gte = new Date(plan.query.timeRange.from);
    if (plan.query.timeRange.to) range.$lte = new Date(plan.query.timeRange.to);
    if (Object.keys(range).length > 0) matchStage[plan.query.timeRange.field] = range;
  }

  pipeline.push({ $match: matchStage });

  // 2. Lookup joins ($lookup + $unwind for each, added before $group)
  if (plan.query.lookups) {
    for (const lookup of plan.query.lookups) {
      pipeline.push({
        $lookup: {
          from: lookup.from,
          localField: lookup.localField,
          foreignField: lookup.foreignField,
          as: lookup.as,
        },
      });
      pipeline.push({
        $unwind: { path: `$${lookup.as}`, preserveNullAndEmptyArrays: true },
      });
    }
  }

  // 3. Group stage
  const dimensions = plan.query.dimensions ?? [];
  const allMetrics = plan.query.metrics?.length
    ? plan.query.metrics
    : plan.query.metric
      ? [plan.query.metric]
      : [];
  const agg = plan.query.aggregation;
  const aggOpMap: Record<string, string> = {
    sum: '$sum', avg: '$avg', min: '$min', max: '$max',
  };

  if (dimensions.length > 0 || agg) {
    const groupId: Record<string, unknown> = {};
    for (const d of dimensions) {
      groupId[d] = isTemporalDimension(d, dataStore)
        ? { $dateToString: { format: '%Y-%m-%d', date: `$${d}`, timezone: 'UTC' } }
        : `$${d}`;
    }

    const groupStage: Record<string, unknown> = {
      _id: dimensions.length > 0 ? groupId : null,
    };

    if (!agg || agg === 'count') {
      groupStage.value = { $sum: 1 };
    } else {
      const aggOp = aggOpMap[agg];
      groupStage.value = allMetrics[0] ? { [aggOp]: `$${allMetrics[0]}` } : { $sum: 1 };
      for (let i = 1; i < allMetrics.length; i++) {
        groupStage[allMetrics[i]] = { [aggOp]: `$${allMetrics[i]}` };
      }
    }

    pipeline.push({ $group: groupStage });

    // 4. Having (post-group filter)
    if (plan.query.having) {
      const h = plan.query.having;
      const havingOpMap: Record<string, string> = {
        gt: '$gt', gte: '$gte', lt: '$lt', lte: '$lte', eq: '$eq',
      };
      pipeline.push({ $match: { [h.field]: { [havingOpMap[h.op]]: h.value } } });
    }

    // 5. Project dimensions + value + extra metrics
    const projection: Record<string, unknown> = { _id: 0, value: 1 };
    for (const d of dimensions) projection[d] = `$_id.${d}`;
    for (let i = 1; i < allMetrics.length; i++) {
      projection[allMetrics[i]] = 1;
    }
    pipeline.push({ $project: projection });
  }

  // 6. Percent of total via $setWindowFields (MongoDB 5.0+)
  if (plan.query.percentOf) {
    pipeline.push({
      $setWindowFields: {
        sortBy: { value: -1 },
        output: {
          _total: { $sum: '$value', window: { documents: ['unbounded', 'unbounded'] } },
        },
      },
    });
    pipeline.push({
      $addFields: {
        percent: {
          $round: [{ $multiply: [{ $divide: ['$value', '$_total'] }, 100] }, 1],
        },
      },
    });
    pipeline.push({ $project: { _total: 0 } });
  }

  // 7. Sort + limit (topN takes priority over manual sort)
  if (plan.query.topN) {
    pipeline.push({ $sort: { value: -1 } });
    pipeline.push({ $limit: plan.query.topN });
  } else {
    if (plan.query.sort && plan.query.sort.length > 0) {
      const sortStage: Record<string, 1 | -1> = {};
      for (const s of plan.query.sort) sortStage[s.field] = s.dir === 'asc' ? 1 : -1;
      pipeline.push({ $sort: sortStage });
    }
    pipeline.push({ $limit: normalizeLimit(plan.query.limit) });
  }

  return { pipeline, collection: dataStore.collection };
}

function normalizeLimit(limit: z.infer<typeof taskPlanSchema>['query']['limit']) {
  const defaultLimit = 1000;
  const maxLimit = 5000;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit <= 0) return defaultLimit;
  return Math.min(limit, maxLimit);
}

export async function executePipeline({
  pipeline,
  collection,
  scope,
}: {
  pipeline: Record<string, unknown>[];
  collection: string;
  scope: z.infer<typeof permissionScopeSchema>;
}) {
  const safePipeline = [...pipeline];
  const hasTenantGuard = safePipeline.some((stage) => {
    const matchStage = (stage as { $match?: Record<string, unknown> }).$match;
    return matchStage && Object.prototype.hasOwnProperty.call(matchStage, 'tenantId');
  });

  if (!hasTenantGuard) {
    safePipeline.unshift({ $match: { tenantId: scope.tenantId } });
  }

  const { db } = await getMongo();
  const rows = await db
    .collection(collection)
    .aggregate(safePipeline, { allowDiskUse: true })
    .toArray() as Record<string, unknown>[];

  return { rows, rowCount: rows.length };
}

export function validateRows({
  rows,
  dataStore,
}: {
  rows: Record<string, unknown>[];
  dataStore: z.infer<typeof dataStoreSchema>;
}) {
  const issues: string[] = [];
  const schema: Record<string, string> = {};
  const fieldMap = new Map(dataStore.fields.map((f) => [f.name, f.type]));

  if (rows.length === 0) return { valid: true, schema: {}, rows: [], issues: [] };

  for (const key of Object.keys(rows[0])) {
    schema[key] = fieldMap.get(key) ?? inferType(rows[0][key]);
  }
  if (!('value' in schema)) schema.value = 'number';

  const cleanRows = rows.map((row) => {
    const out: Record<string, string | number | boolean | null> = {};
    for (const [k, v] of Object.entries(row)) {
      if (v === null || v === undefined) out[k] = null;
      else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
      else if (v instanceof Date) out[k] = v.toISOString();
      else out[k] = String(v);
    }
    return out;
  });

  return { valid: issues.length === 0, schema, rows: cleanRows, issues };
}

function inferType(v: unknown): string {
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  if (v instanceof Date) return 'datetime';
  return 'string';
}

function isTemporalDimension(dimension: string, dataStore: z.infer<typeof dataStoreSchema>) {
  const field = dataStore.fields.find((f) => f.name === dimension);
  if (!field) return false;
  const role = field.role as string | undefined;
  return role === 'temporal' || field.type === 'date' || field.type === 'datetime';
}

function normalizeToken(value: string | undefined) {
  return value?.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}
