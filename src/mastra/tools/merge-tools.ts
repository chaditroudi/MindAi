import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { datasetSchema } from '../schemas/intent.js';

export function mergeDatasets({
  primary,
  secondary,
  joinKey,
  secondaryLabel,
}: {
  primary: z.infer<typeof datasetSchema>;
  secondary?: z.infer<typeof datasetSchema>;
  joinKey: string;
  secondaryLabel: string;
}) {
  if (!secondary || secondary.rows.length === 0) return primary;

  const secondaryByKey = new Map<unknown, number>();
  for (const row of secondary.rows) {
    secondaryByKey.set(row[joinKey], Number(row.value ?? row[secondaryLabel] ?? 0));
  }

  const mergedRows = primary.rows.map((row) => ({
    ...row,
    [secondaryLabel]: secondaryByKey.get(row[joinKey]) ?? null,
  }));

  return {
    rows: mergedRows,
    schema: { ...primary.schema, [secondaryLabel]: 'number' },
    source: 'merged' as const,
    citations: [...(primary.citations ?? []), ...(secondary.citations ?? [])],
  };
}

export const mergeResultsTool = createTool({
  id: 'merge-results',
  description: 'Merge a primary (MongoDB) dataset with a secondary (Search) dataset on the shared dimension key. Adds the external series alongside the internal one.',
  inputSchema: z.object({
    primary: datasetSchema,
    secondary: datasetSchema.optional(),
    joinKey: z.string(),
    secondaryLabel: z.string().default('benchmark'),
  }),
  outputSchema: datasetSchema,
  execute: async ({ context }) => {
    return mergeDatasets(context);
  },
});
