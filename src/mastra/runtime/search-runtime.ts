import type { Mastra } from '@mastra/core/mastra';
import { z } from 'zod';
import { datasetSchema, taskPlanSchema } from '../schemas/intent.js';

export async function runSearchEnrichment({
  mastra,
  enrichment,
  joinKey,
}: {
  mastra: Mastra;
  enrichment: NonNullable<z.infer<typeof taskPlanSchema>['enrichment']>;
  joinKey?: string;
}) {
  const search = mastra.getAgent('searchAgent');
  const result = await search.generate(
    [
      {
        role: 'user',
        content: JSON.stringify({
          ...enrichment,
          joinKey,
        }),
      },
    ],
    { output: datasetSchema, maxTokens: 2200 },
  );

  return result.object;
}
