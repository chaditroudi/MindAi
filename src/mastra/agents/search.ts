import { Agent } from '@mastra/core/agent';
import type { Mastra } from '@mastra/core/mastra';
import { z } from 'zod';
import { resolveModel } from '../model.js';
import { composeWithSkills } from '../skills/compose.js';
import { searchStrategySkill } from '../skills/search-strategy/index.js';
import { resolveDataStores } from '../../db/datastore.repository.js';
import type { DataStore } from '../../types/index.js';
import type { PermissionScope } from '../../types/index.js';
import { parseJsonOutput } from '../../utils/json-output.js';
import { runQueuedLlmCall } from '../../utils/llm-queue.js';
import { envTimeout, withTimeout } from '../../utils/timeout.js';

export const searchPlanSchema = z.object({
  collection: z.string(),
  collectionLabel: z.string(),
  searchTerms: z.array(z.string()),
  pipeline: z.array(z.record(z.unknown())),
});

export type SearchPlan = z.infer<typeof searchPlanSchema>;

const BASE_INSTRUCTIONS = `
You are a search planner for a MongoDB-backed platform.

Your job: given a user query and a database schema, pick the best collection to search and build a MongoDB aggregation pipeline that finds matching records using $regex on relevant string fields.

## Rules
- Pick the single most relevant collection based on the user's query.
- Extract all meaningful search keywords from the query (ignore stop words like "the", "in", "find", "show", "me").
- Build one combined regex pattern: join terms with "|" (OR). Example: "road|repairs|ramallah".
- Apply $regex (case-insensitive) to every string field that could contain descriptive text (fields of type "string" whose name suggests content: title, name, description, notes, address, type, status, subject, etc.).
- Ignore numeric, date, boolean, and reference/ID fields.
- Always add { "$sort": { "_id": -1 } } and { "$limit": 25 } at the end.
- NEVER include tenantId in the pipeline (it is injected automatically).
- Return ONLY valid JSON — no markdown, no prose, no code fences.

## Output format
{
  "collection": "exact_collection_name",
  "collectionLabel": "Human Readable Name",
  "searchTerms": ["term1", "term2"],
  "pipeline": [
    { "$match": { "$or": [ { "title": { "$regex": "term1|term2", "$options": "i" } }, { "name": { "$regex": "term1|term2", "$options": "i" } } ] } },
    { "$sort": { "_id": -1 } },
    { "$limit": 25 }
  ]
}
`;

export const searchAgent: Agent = new Agent({
  name: 'Search Agent',
  instructions: composeWithSkills(BASE_INSTRUCTIONS, [searchStrategySkill]),
  model: resolveModel('search'),
});

// ─── Search Runtime ───────────────────────────────────────────────────────────

export async function runSearchPlan({
  mastra,
  prompt,
  scope,
  dataStoreName,
  datastores,
}: {
  mastra: Mastra;
  prompt: string;
  scope: PermissionScope;
  dataStoreName?: string;
  datastores?: DataStore[];
}): Promise<SearchPlan> {
  const agent = mastra.getAgent('searchAgent');
  const dataStores = await resolveDataStores(scope, datastores);

  const compactStores = dataStores.map((ds) => ({
    name: ds.name,
    collection: ds.collection,
    fields: ds.fields
      .filter((f) => f.type === 'string')
      .map((f) => ({ name: f.name, type: f.type, ...(f.description ? { description: f.description } : {}) })),
  }));

  const messages = [
    {
      role: 'system' as const,
      content:
        'Return exactly one JSON object matching the SearchPlan schema. Required keys: collection, collectionLabel, searchTerms, pipeline.',
    },
    {
      role: 'user' as const,
      content: JSON.stringify({
        userQuery: prompt,
        preferredCollection: dataStoreName ?? null,
        platform: { dataStores: compactStores },
      }),
    },
  ];

  const result = await withTimeout(
    runQueuedLlmCall(() => agent.generate(messages, { maxTokens: 600, temperature: 0 })),
    'search.plan',
    envTimeout('SEARCH_TIMEOUT_MS', 5000),
  );

  return parseJsonOutput(result.text, searchPlanSchema);
}
