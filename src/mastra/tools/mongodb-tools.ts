import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { buildPipeline } from '../../analytics/builders/build-pipeline.js';
import { runAggregation } from '../../analytics/executor/run-aggregation.js';
import { dataStoreRepo } from '../../db/datastore.repository.js';
import { dataStoreSchema, permissionScopeSchema } from '../schemas/datastore.js';
import { taskPlanSchema } from '../schemas/intent.js';

const resolveDataStoreInputSchema = z.object({
  dataStoreId: z.string().optional(),
  dataStoreName: z.string().optional(),
  scope: permissionScopeSchema,
});

export const resolveDataStoreTool = createTool({
  id: 'resolveDataStore',
  description:
    'Resolve a Data Store identifier into accessible Data Store metadata: collection, typed fields, and joins.',
  inputSchema: resolveDataStoreInputSchema,
  outputSchema: z.object({
    dataStore: dataStoreSchema.optional(),
    dataStores: z.array(dataStoreSchema),
  }),
  execute: async ({ context }) => resolveDataStore(context),
});

export const buildAggregationTool = createTool({
  id: 'buildAggregation',
  description:
    'Translate a structured query plan into a MongoDB aggregation pipeline. Returns the pipeline as a JSON array without executing it. Supports topN, having, lookups, multi-metric, percentOf, nin, and regex.',
  inputSchema: z.object({
    plan: taskPlanSchema,
    dataStore: dataStoreSchema.optional(),
    scope: permissionScopeSchema,
  }),
  outputSchema: z.object({
    pipeline: z.array(z.record(z.unknown())),
    collection: z.string(),
  }),
  execute: async ({ context }) => {
    const dataStore = context.dataStore;
    if (!dataStore) {
      throw new Error('buildAggregation requires a resolved dataStore.');
    }

    return buildAggregationFromPlan({ plan: context.plan, dataStore, scope: context.scope });
  },
});

export const executePipelineTool = createTool({
  id: 'executePipeline',
  description: 'Execute a safe MongoDB aggregation pipeline produced by buildAggregation.',
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
  id: 'validateRows',
  description: 'Validate rows shape and produce a field→type schema for downstream agents.',
  inputSchema: z.object({
    rows: z.array(z.record(z.unknown())),
    dataStore: dataStoreSchema.optional(),
  }),
  outputSchema: z.object({
    valid: z.boolean(),
    schema: z.record(z.string()),
    jsonSchema: z.record(z.unknown()),
    rows: z.array(z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]))),
    issues: z.array(z.string()),
  }),
  execute: async ({ context }) => {
    const dataStore = context.dataStore;
    if (!dataStore) {
      throw new Error('validateRows requires a resolved dataStore.');
    }

    return validateRows({ rows: context.rows, dataStore });
  },
});

export async function resolveDataStore({
  dataStoreId,
  dataStoreName,
  scope,
}: z.infer<typeof resolveDataStoreInputSchema>) {
  const dataStores = await dataStoreRepo.listAccessibleDataStores(scope);
  const identifiers = [dataStoreId, dataStoreName]
    .map(normalizeToken)
    .filter((identifier): identifier is string => Boolean(identifier));

  if (identifiers.length === 0) {
    return { dataStores };
  }

  const matches = dataStores.filter((ds) => identifiers.some((identifier) => matchesDataStore(ds, identifier)));
  const resolved = matches[0];

  return {
    dataStore: resolved,
    dataStores: matches,
  };
}

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

  if (rows.length === 0) {
    return {
      valid: true,
      schema: {},
      jsonSchema: buildOutputJsonSchema({}),
      rows: [],
      issues: [],
    };
  }

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

  return {
    valid: issues.length === 0,
    schema,
    jsonSchema: buildOutputJsonSchema(schema),
    rows: cleanRows,
    issues,
  };
}

function inferType(v: unknown): string {
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  if (v instanceof Date) return 'datetime';
  return 'string';
}

function buildOutputJsonSchema(schema: Record<string, string>) {
  const properties = Object.fromEntries(
    Object.entries(schema).map(([field, type]) => [
      field,
      { type: jsonSchemaTypesForField(type) },
    ]),
  );

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      properties,
      required: Object.keys(properties),
    },
  };
}

function jsonSchemaTypesForField(type: string) {
  if (type === 'number' || type === 'integer') return ['number', 'null'];
  if (type === 'boolean') return ['boolean', 'null'];
  return ['string', 'null'];
}

function matchesDataStore(dataStore: z.infer<typeof dataStoreSchema>, normalizedIdentifier: string) {
  const raw = dataStore as Record<string, unknown>;
  const candidates = [
    dataStore.name,
    dataStore.collection,
    stringifyProperty(raw.id),
    stringifyProperty(raw._id),
  ];

  return candidates.some((candidate) => normalizeToken(candidate) === normalizedIdentifier);
}

function stringifyProperty(value: unknown) {
  if (value === undefined || value === null) return undefined;
  return String(value);
}

function normalizeToken(value: string | undefined) {
  return value?.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}
