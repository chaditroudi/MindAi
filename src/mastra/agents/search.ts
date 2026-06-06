import { generateText } from 'ai';
import { z } from 'zod';
import { resolveModel } from '../model.js';
import { resolveSources } from '../../db/source.repository.js';
import type { DataSource, PermissionScope } from '../../types/index.js';
import { parseJsonOutput } from '../../utils/json-output.js';
import { runQueuedLlmCall } from '../../utils/llm-queue.js';
import { envTimeout, withTimeout } from '../../utils/timeout.js';

export const searchPlanSchema = z.object({
  collection:      z.string(),
  collectionLabel: z.string(),
  searchTerms:     z.array(z.string()),
  pipeline:        z.array(z.record(z.unknown())),
});
export type SearchPlan = z.infer<typeof searchPlanSchema>;

const BASE_INSTRUCTIONS = `
You are a search planner for a MongoDB-backed platform.
Given a user query and database schema, pick the best collection and build a MongoDB $regex aggregation pipeline.

Rules:
- Pick the single most relevant collection.
- Extract meaningful keywords (ignore stop words: the, in, find, show, me, etc.).
- Build one OR regex pattern: "term1|term2".
- Apply $regex (case-insensitive) to string fields with content names (title, name, description, notes, address, status, etc.).
- Skip numeric, date, boolean, ID fields.
- Always end with { "$sort": { "_id": -1 } } and { "$limit": 25 }.
- NEVER include tenantId. Return ONLY valid JSON.

Output: { "collection", "collectionLabel", "searchTerms", "pipeline" }
`;

export async function runSearchPlan({
  prompt, scope, sourceName, sources,
}: {
  prompt: string;
  scope: PermissionScope;
  sourceName?: string;
  sources?: DataSource[];
}): Promise<SearchPlan> {
  const availableSources = await resolveSources(scope, sources);
  const compactStores  = availableSources.map((ds) => ({
    name: ds.name, collection: ds.collection,
    fields: ds.fields.filter((f) => f.type === 'string').map((f) => ({ name: f.name, type: f.type, ...(f.description && { description: f.description }) })),
  }));

  const messages = [
    { role: 'system' as const, content: `${BASE_INSTRUCTIONS}\n\nReturn exactly one JSON object. Required keys: collection, collectionLabel, searchTerms, pipeline.` },
    { role: 'user' as const, content: JSON.stringify({ userQuery: prompt, preferredSource: sourceName ?? null, availableSources: compactStores }) },
  ];

  const { text } = await withTimeout(
    runQueuedLlmCall(() => generateText({ model: resolveModel('search'), messages, maxTokens: 600, temperature: 0 })),
    'search.plan', envTimeout('SEARCH_TIMEOUT_MS', 5000),
  );

  return parseJsonOutput(text, searchPlanSchema);
}
