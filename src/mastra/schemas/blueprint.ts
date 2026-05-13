import { z } from 'zod';

export const fieldTypeSchema = z.enum([
  'string',
  'number',
  'integer',
  'boolean',
  'date',
  'datetime',
  'enum',
  'reference',
  'array',
  'object',
  'geo',
]);

export const blueprintFieldSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  type: fieldTypeSchema,
  enumValues: z.array(z.string()).optional(),
  referenceTo: z.string().optional(),
  role: z.enum(['dimension', 'measure', 'temporal', 'id']).optional(),
});

export const dataStoreSchema = z.object({
  name: z.string(),
  collection: z.string(),
  description: z.string().optional(),
  fields: z.array(blueprintFieldSchema),
});

export const blueprintSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  dataStores: z.array(dataStoreSchema),
});

export const platformSchema = z.object({
  blueprints: z.array(blueprintSchema),
});

export const permissionScopeSchema = z.object({
  userId: z.string(),
  tenantId: z.string(),
  allowedBlueprintIds: z.array(z.string()),
  rowFilter: z.record(z.unknown()).optional(),
});
