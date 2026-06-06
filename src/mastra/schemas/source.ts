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
  'text',
]);

export const sourceFieldSchema = z.object({
  name: z.string(),
  label: z.string().optional(),
  description: z.string().optional(),
  type: fieldTypeSchema,
  role: z.enum(['dimension', 'measure', 'temporal', 'id', 'text']).optional(),
  enumValues: z.array(z.string()).optional(),
  referenceTo: z.string().optional(),
  sampleValues: z.array(z.unknown()).optional(),
  searchable: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
});

export const sourceJoinSchema = z.object({
  from: z.string(),
  localField: z.string(),
  foreignField: z.string(),
  as: z.string(),
});

export const sourceSchema = z.object({
  name: z.string(),
  collection: z.string(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  fields: z.array(sourceFieldSchema),
  joins: z.array(sourceJoinSchema).optional(),
});

export const platformSchema = z.object({
  sources: z.array(sourceSchema),
});

export const permissionScopeSchema = z.object({
  userId: z.string(),
  tenantId: z.string(),
  allowedSources: z.array(z.string()).optional(),
  rowFilter: z.record(z.unknown()).optional(),
});
