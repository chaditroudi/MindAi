import type { Mastra } from '@mastra/core/mastra';
import { z } from 'zod';
import { datasetSchema, taskPlanSchema } from '../schemas/intent.js';

export async function runSearchEnrichment({
  mastra,
  enrichment,
  joinKey,
  primarySchema,
  timeRange,
}: {
  mastra: Mastra;
  enrichment: NonNullable<z.infer<typeof taskPlanSchema>['enrichment']>;
  joinKey?: string;
  primarySchema?: Record<string, string>;
  timeRange?: z.infer<typeof taskPlanSchema>['query']['timeRange'];
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
        timeRange: enrichment.timeRange ?? timeRange,
        allowList: enrichment.sources,
        joinKey,
        primarySchema,  // agent now knows the exact field names/types to match
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
