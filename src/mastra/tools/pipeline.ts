import { createTool } from '@mastra/core';
import { z } from 'zod';
import { executePipeline, executePipelineInMemory, validateRows } from '../../db/aggregation.js';
import { findSource } from '../../db/source.repository.js';
import type { DataSource, PermissionScope } from '../../types/index.js';

const scopeSchema = z.object({
  userId: z.string().default(''),
  tenantId: z.string().default(''),
  allowedSources: z.array(z.string()).optional(),
  rowFilter: z.record(z.unknown()).optional(),
});

export const pipelineToolInputSchema = z.object({
  pipeline: z.array(z.record(z.unknown())),
  resolvedSourceName: z.string().optional(),
  sources: z.array(z.unknown()).optional(),
  inlineRows: z.array(z.record(z.unknown())).optional(),
  scope: scopeSchema,
});

export const pipelineToolOutputSchema = z.object({
  rows: z.array(z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]))),
  schema: z.record(z.string()),
  source: z.enum(['mongodb', 'search', 'merged']),
});

export const executePipelineTool = createTool({
  id: 'execute-pipeline',
  description: 'Runs a MongoDB aggregation pipeline against a collection or in-memory rows and returns typed rows with a schema map.',
  inputSchema: pipelineToolInputSchema,
  outputSchema: pipelineToolOutputSchema,
  execute: async ({ context }) => {
    const { pipeline, resolvedSourceName, sources, inlineRows, scope } = context;
    const permScope = scope as unknown as PermissionScope;

    let rawRows: Record<string, unknown>[];

    if (inlineRows?.length) {
      rawRows = executePipelineInMemory({ pipeline, rows: inlineRows, scope: permScope }).rows;
    } else {
      const sourceName = resolvedSourceName ?? '';
      const source = findSource(sourceName, (sources ?? []) as DataSource[]);
      const collection = source?.collection ?? sourceName;
      rawRows = (await executePipeline({ pipeline, collection, scope: permScope })).rows;
    }

    const { rows, schema } = validateRows(rawRows);
    return { rows, schema, source: 'mongodb' as const };
  },
});
