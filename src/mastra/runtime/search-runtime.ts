import type { Mastra } from '@mastra/core/mastra';
import { z } from 'zod';
import { log } from '../../observability/log.js';
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
  const messages = [
    {
      role: 'user' as const,
      content: JSON.stringify({
        ...enrichment,
        joinKey,
      }),
    },
  ];

  try {
    const result = await search.generate(messages, { output: datasetSchema, maxTokens: 2200, temperature: 0 });
    return result.object;
  } catch (error) {
    log.warn('search.enrichment.retry', {
      agent: 'searchAgent',
      topic: enrichment.topic,
      err: error instanceof Error ? error.message : String(error),
    });
    const retry = await search.generate(
      [
        {
          role: 'user',
          content:
            'Your previous response was invalid JSON. Return exactly one valid JSON object matching the dataset schema: { "rows": [], "schema": {}, "source": "search", "citations"?: [] }. No markdown or prose outside JSON.',
        },
        ...messages,
      ],
      { output: datasetSchema, maxTokens: 2200, temperature: 0 },
    );
    return retry.object;
  }
}
