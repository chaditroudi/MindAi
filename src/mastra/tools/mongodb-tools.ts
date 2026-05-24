import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { buildPipeline } from '../../analytics/builders/build-pipeline.js';
import { runAggregation } from '../../analytics/executor/run-aggregation.js';
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
  const { pipeline, collection } = buildPipeline({ plan, dataStore, scope });
  return { pipeline, collection };
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
  return runAggregation({ pipeline, collection, scope });
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

function normalizeToken(value: string | undefined) {
  return value?.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}
