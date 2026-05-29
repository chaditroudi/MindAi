import type { Mastra } from '@mastra/core/mastra';
import { z } from 'zod';
import { datasetSchema, taskPlanSchema } from '../schemas/intent.js';

export async function runSearchEnrichment({
  mastra,
  enrichment,
  joinKey,
  primarySchema,
  timeRange,
  tenantId,
}: {
  mastra: Mastra;
  enrichment: NonNullable<z.infer<typeof taskPlanSchema>['enrichment']>;
  joinKey?: string;
  primarySchema?: Record<string, string>;
  timeRange?: z.infer<typeof taskPlanSchema>['query']['timeRange'];
  tenantId: string;
}) {
  const search = mastra.getAgent('searchAgent');
  const messages = [
    {
      role: 'system' as const,
      content:
        'Return exactly one JSON object matching Dataset: { "rows": [], "schema": {}, "source": "search", "citations": [] }. No markdown, no prose, no code fence.',
    },
    {
      role: 'user' as const,
      content: JSON.stringify({
        ...enrichment,
        tenantId,
        timeRange: enrichment.timeRange ?? timeRange,
        joinKey,
        primarySchema,
        outputRules: {
          source: 'search',
          alignRowsToDimensionKeys: enrichment.dimensions,
          requireCitations: true,
        },
      }),
    },
  ];

  const result = await search.generate(messages, {
    output: datasetSchema,
    maxTokens: 2200,
    temperature: 0,
  });
  return result.object;
}
