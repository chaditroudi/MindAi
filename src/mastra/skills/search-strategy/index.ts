import type { AgentSkill } from '../compose.js';

export const searchStrategySkill: AgentSkill = {
  id: 'search-strategy',
  name: 'Search Strategy',
  version: '1.0.0',
  description:
    'Expert rules for extracting search keywords, selecting the right collection, '
    + 'and building effective MongoDB regex pipelines for free-text search.',
  applicableAgents: ['Search Agent'],
  tags: ['search', 'mongodb', 'regex', 'arabic', 'keyword-extraction'],
  instructions: `
SEARCH STRATEGY — EXPERT RULES

COLLECTION SELECTION
  • Pick the ONE collection most likely to contain the user's target records.
  • If the user names a collection or data type explicitly, use it.
  • If the user is vague, prefer the collection with the most text/string fields.
  • When "preferredCollection" is set in input, always use it.

KEYWORD EXTRACTION
  Arabic stop words to IGNORE: في، من، إلى، على، عن، هل، ما، مع، هذا، هذه، تلك، التي، الذي، كل، بعض، أي
  English stop words to IGNORE: the, in, of, for, to, a, an, is, are, find, show, me, list, get, search

  Rules:
  • Keep nouns, proper nouns, adjectives, verbs (meaningful words only).
  • For Arabic text: keep root forms when possible (e.g. "مشاريع" and "مشروع" → use "مشروع").
  • For location names: always keep them as full tokens (e.g. "رام الله" → one term "رامالله" with spaces stripped for regex).
  • Minimum 1 keyword, maximum 6 keywords.
  • Remove duplicate and redundant terms.

REGEX PATTERN BUILDING
  • Join keywords with "|" to create an OR pattern: "road|repairs|ramallah"
  • Apply to EVERY string field that could hold descriptive content.
  • TARGET fields (search these): title, name, description, notes, subject, address,
    type, status, category, comment, details, remarks, label, content.
  • SKIP fields: id, _id, tenantId, any field ending in "Id", date/time fields,
    numeric fields, boolean fields.
  • Always set $options: "i" (case-insensitive).

PIPELINE STRUCTURE
  1. $match with $or across all targeted string fields.
  2. $sort: { "_id": -1 } — most recent first.
  3. $limit: 25 — always.

  Example pipeline for query "road repairs ramallah" on a Projects collection
  with fields [title, description, status, municipality]:
  [
    { "$match": { "$or": [
      { "title":        { "$regex": "road|repairs|ramallah", "$options": "i" } },
      { "description":  { "$regex": "road|repairs|ramallah", "$options": "i" } },
      { "municipality": { "$regex": "road|repairs|ramallah", "$options": "i" } }
    ] } },
    { "$sort": { "_id": -1 } },
    { "$limit": 25 }
  ]
  Note: "status" was skipped because it is an enum (not free text).

RESULT QUALITY RULES
  • If searchTerms would be empty after filtering stop words, use the full raw query as one term.
  • Never produce an empty pipeline — always have at least one $or clause.
  • Do not add a $project stage — return all fields so the writer can summarize them.
`,
};
