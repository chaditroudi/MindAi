import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { searchExportKnowledge, semanticSearchExportKnowledge } from '../../knowledge/export-knowledge.js';
import { log } from '../../observability/log.js';

const vectorSearchInputSchema = z.object({
  query: z.string(),
  topK: z.number().int().min(1).max(20).default(5),
  tenantId: z.string(),
});

const vectorSearchOutputSchema = z.object({
  chunks: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      source: z.string(),
      score: z.number(),
    }),
  ),
});

async function runVectorSearch(context: z.infer<typeof vectorSearchInputSchema>) {
  let mode: 'semantic' | 'lexical' = 'semantic';
  let hits;

  try {
    hits = await semanticSearchExportKnowledge(context.query, context.topK, context.tenantId);
  } catch (error) {
    mode = 'lexical';
    hits = searchExportKnowledge(context.query, context.topK);
    log.warn('search.vector-search-lexical-mode', {
      tenantId: context.tenantId,
      queryLength: context.query.length,
      topK: context.topK,
      err: error instanceof Error ? error.message : String(error),
    });
  }

  log.info('search.vector-search', {
    tenantId: context.tenantId,
    queryLength: context.query.length,
    topK: context.topK,
    hitCount: hits.length,
    mode,
  });

  return {
    chunks: hits.map((hit) => ({
      id: hit.id,
      text: hit.text,
      source: hit.collection,
      score: hit.score,
    })),
  };
}

export const vectorSearchTool = createTool({
  id: 'vector-search',
  description:
    'Internal search over the Mind Platform knowledge corpus. Uses semantic search when indexed, or local lexical search over exported DB JSON.',
  inputSchema: vectorSearchInputSchema,
  outputSchema: vectorSearchOutputSchema,
  execute: async ({ context }) => runVectorSearch(context),
});

export const vectorSearchContractTool = createTool({
  id: 'vectorSearch',
  description:
    'Internal search over the Mind Platform knowledge corpus. Uses semantic search when indexed, or local lexical search over exported DB JSON.',
  inputSchema: vectorSearchInputSchema,
  outputSchema: vectorSearchOutputSchema,
  execute: async ({ context }) => runVectorSearch(context),
});
