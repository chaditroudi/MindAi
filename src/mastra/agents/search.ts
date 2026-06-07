import { generateText } from 'ai';
import { z } from 'zod';
import { resolveModel } from '../model.js';
import { getSources } from '../../db/sources-cache.js';
import { parseJsonOutput } from '../../utils/json-output.js';
import type { DataSource } from '../../types/index.js';

const searchPlanSchema = z.object({
  collection:      z.string(),
  collectionLabel: z.string(),
  searchTerms:     z.array(z.string()),
  pipeline:        z.array(z.record(z.unknown())),
});

export type SearchPlan = z.infer<typeof searchPlanSchema>;

const INSTRUCTIONS = `
You are a search planner for a MongoDB-backed platform.
Given a user query and database schema, pick the best collection and build a MongoDB $regex aggregation pipeline.

Rules:
- Pick the single most relevant collection.
- Extract meaningful keywords (ignore stop words: the, in, find, show, me, etc.).
- Build one OR regex pattern: "term1|term2".
- Apply $regex (case-insensitive) to string fields only.
- Always end with { "$sort": { "_id": -1 } } and { "$limit": 25 }.
- Return JSON only: { collection, collectionLabel, searchTerms, pipeline }
`;

export async function runSearchPlan({
  prompt,
  sourceName,
  sources,
}: {
  prompt:      string;
  sourceName?: string;
  sources?:    DataSource[];
}): Promise<SearchPlan> {
  const available     = sources?.length ? sources : getSources();
  const compactStores = available.map(ds => ({
    name:       ds.name,
    collection: ds.collection,
    fields:     ds.fields.filter(f => f.type === 'string').map(f => ({
      name: f.name,
      type: f.type,
      ...(f.description ? { description: f.description } : {}),
    })),
  }));

  const { text } = await generateText({
    model:       resolveModel('search'),
    maxTokens:   600,
    temperature: 0,
    messages: [
      { role: 'system', content: INSTRUCTIONS },
      {
        role:    'user',
        content: JSON.stringify({
          userQuery:        prompt,
          preferredSource:  sourceName ?? null,
          availableSources: compactStores,
        }),
      },
    ],
  });

  return searchPlanSchema.parse(parseJsonOutput(text));
}
