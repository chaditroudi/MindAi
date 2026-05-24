import type { Mastra } from '@mastra/core/mastra';
import { z } from 'zod';
import { datasetSchema, taskPlanSchema } from '../schemas/intent.js';
import { parseJsonOutput } from './json-output.js';

export async function runSearchEnrichment({
  mastra,
  enrichment,
  joinKey,
  primarySchema,
}: {
  mastra: Mastra;
  enrichment: NonNullable<z.infer<typeof taskPlanSchema>['enrichment']>;
  joinKey?: string;
  primarySchema?: Record<string, string>;
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
        joinKey,
        primarySchema,  // agent now knows the exact field names/types to match
      }),
    },
  ];

  const result = await search.generate(messages, { maxTokens: 2200, temperature: 0 });
  return parseJsonOutput(result.text, datasetSchema);
}
