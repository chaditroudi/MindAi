import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getMongo } from '../../db/mongo.client.js';
import { blueprintRepo } from '../../db/blueprint.repository.js';
import { blueprintSchema, dataStoreSchema, permissionScopeSchema } from '../schemas/blueprint.js';
import { taskPlanSchema } from '../schemas/intent.js';

export const resolveBlueprintTool = createTool({
  id: 'resolve-blueprint',
  description:
    'Look up a Blueprint by id (or list accessible ones). Returns Data Stores and their typed fields so you know what is queryable.',
  inputSchema: z.object({
    blueprintId: z.string().optional(),
    allowedBlueprintIds: z.array(z.string()),
  }),
  outputSchema: z.object({
    blueprints: z.array(blueprintSchema),
  }),
  execute: async ({ context }) => {
    const { blueprintId, allowedBlueprintIds } = context;
    if (blueprintId) {
      if (!allowedBlueprintIds.includes(blueprintId)) {
        throw new Error(`Blueprint ${blueprintId} is not in the user's allowed scope.`);
      }
      const bp = await blueprintRepo.getById(blueprintId);
      return { blueprints: bp ? [bp] : [] };
    }
    const bps = await blueprintRepo.listAccessible(allowedBlueprintIds);
    return { blueprints: bps };
  },
});

export const buildAggregationTool = createTool({
  id: 'build-aggregation',
  description:
    'Translate a structured query plan into a MongoDB aggregation pipeline. Returns the pipeline as a JSON array without executing it.',
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

  const matchStage: Record<string, unknown> = { tenantId: scope.tenantId };
  if (scope.rowFilter) Object.assign(matchStage, scope.rowFilter);

  if (plan.query.filters) {
    for (const f of plan.query.filters) {
      const opMap: Record<string, string> = {
        eq: '$eq',
        ne: '$ne',
        gt: '$gt',
        gte: '$gte',
        lt: '$lt',
        lte: '$lte',
        in: '$in',
      };
      matchStage[f.field] = { [opMap[f.op]]: f.value };
    }
  }

  if (plan.query.timeRange) {
    const range: Record<string, unknown> = {};
    if (plan.query.timeRange.from) range.$gte = new Date(plan.query.timeRange.from);
    if (plan.query.timeRange.to) range.$lte = new Date(plan.query.timeRange.to);
    if (Object.keys(range).length > 0) matchStage[plan.query.timeRange.field] = range;
  }

  pipeline.push({ $match: matchStage });

  const dimensions = plan.query.dimensions ?? [];
  if (dimensions.length > 0 || plan.query.aggregation) {
    const groupId: Record<string, string> = {};
    for (const d of dimensions) groupId[d] = `$${d}`;

    const groupStage: Record<string, unknown> = {
      _id: dimensions.length > 0 ? groupId : null,
    };

    if (plan.query.aggregation && plan.query.metric) {
      const aggOpMap: Record<string, string> = {
        sum: '$sum',
        avg: '$avg',
        min: '$min',
        max: '$max',
      };
      if (plan.query.aggregation === 'count') {
        groupStage.value = { $sum: 1 };
      } else {
        const aggOp = aggOpMap[plan.query.aggregation];
        groupStage.value = { [aggOp]: `$${plan.query.metric}` };
      }
    } else {
      groupStage.value = { $sum: 1 };
    }

    pipeline.push({ $group: groupStage });

    const projection: Record<string, unknown> = { _id: 0, value: 1 };
    for (const d of dimensions) projection[d] = `$_id.${d}`;
    pipeline.push({ $project: projection });
  }

  if (plan.query.sort && plan.query.sort.length > 0) {
    const sortStage: Record<string, 1 | -1> = {};
    for (const s of plan.query.sort) sortStage[s.field] = s.dir === 'asc' ? 1 : -1;
    pipeline.push({ $sort: sortStage });
  }

  pipeline.push({ $limit: normalizeLimit(plan.query.limit) });

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
  const rows = await db.collection(collection).aggregate(safePipeline, { allowDiskUse: true }).toArray();

  return { rows: rows as Record<string, unknown>[], rowCount: rows.length };
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
  if (rows.length === 0) {
    return { valid: true, schema: {}, rows: [], issues: [] };
  }

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
