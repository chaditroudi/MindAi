import { generateText } from 'ai';
import { resolveModel } from '../model.js';
import { finalizeTaskPlan } from '../task-plan.js';
import { normalizeToken } from '../../db/source.repository.js';
import { parseJsonOutput } from '../../utils/json-output.js';
import { log } from '../../utils/logger.js';
import type { DataSource, TaskPlan, IntentKind } from '../../types/index.js';

const PLAN_INTENT_FIX = /"intent"\s*:\s*"inquiry"/;

const INSTRUCTIONS = `
You are the analytics supervisor for a films and directors database.

DATABASE SCHEMA (use ONLY these fields — never invent fields):

Collection: films
  title     string    Film title
  genre     enum      Sci-Fi | Action | Drama | Thriller | Crime | Comedy | Romance | Western | Horror
  year      integer   Release year (1990–2024)
  director  string    Director full name → joins directors.name
  revenue   number    Box office revenue in million USD
  budget    number    Production budget in million USD
  rating    number    IMDb rating (0–10)
  duration  integer   Film duration in minutes
  country   string    Production country
  studio    string    Production studio (Warner Bros, Universal, Fox, Paramount, Netflix, Miramax, Columbia, Weinstein)
  awards    integer   Number of awards won

Collection: directors
  name        string   Director full name
  nationality string   Nationality (British, American, Canadian, Mexican)
  birthYear   integer  Year of birth
  totalFilms  integer  Total career films directed

Join available: films.director → directors.name AS directorInfo

─────────────────────────────────────────────────────────────
PIPELINE PATTERNS — copy exactly, substitute field names:

Count per group (e.g. films per genre):
  [{"$group":{"_id":"$genre","value":{"$sum":1}}},{"$sort":{"value":-1}},{"$project":{"_id":0,"label":"$_id","value":1}}]

Sum per group (e.g. total revenue per studio):
  [{"$group":{"_id":"$studio","value":{"$sum":"$revenue"}}},{"$sort":{"value":-1}},{"$project":{"_id":0,"label":"$_id","value":1}}]

Average per group (e.g. avg rating per genre):
  [{"$group":{"_id":"$genre","value":{"$avg":"$rating"}}},{"$sort":{"value":-1}},{"$project":{"_id":0,"label":"$_id","value":1}}]

Top N (add $limit after $sort):
  [..., {"$sort":{"value":-1}}, {"$limit":5}]

Trend over time (count or sum by year):
  [{"$group":{"_id":"$year","value":{"$sum":1}}},{"$sort":{"_id":1}},{"$project":{"_id":0,"year":"$_id","value":1}}]

Two metrics per item (scatter / compare):
  [{"$project":{"_id":0,"label":"$title","x":"$budget","y":"$revenue"}}]

Raw list:
  [{"$sort":{"revenue":-1}},{"$limit":20},{"$project":{"_id":0,"title":1,"genre":1,"revenue":1,"rating":1}}]

With join (films + directors):
  [{"$lookup":{"from":"directors","localField":"director","foreignField":"name","as":"directorInfo"}},{"$unwind":"$directorInfo"},{"$group":{"_id":"$director","value":{"$sum":1}}},{"$sort":{"value":-1}},{"$project":{"_id":0,"label":"$_id","value":1}}]

─────────────────────────────────────────────────────────────
FIELD PROJECTION RULES (critical for chart accuracy):
- Single-metric aggregation  → always project as { label, value }
- Two-metric / scatter       → always project as { label, x, y }
- Trend / time series        → always project as { year, value }  (or { month, value })
- Raw list                   → project all needed fields by name
- NEVER expose _id in output

CHARITHINT — pick exactly one based on what the data represents:
  "ranking"      → top/bottom N items compared by one metric
  "distribution" → count/spread across categories (how many per genre)
  "trend"        → values over time (by year)
  "part_of_whole"→ shares or percentages that sum to a whole
  "compare"      → two or more metrics side by side for same items
  "scatter"      → correlation between two numeric fields

RULES:
- Always set query.sourceName to the root collection name (e.g. "Films" or "Directors").
- Use ONLY fields from the schema above. Never invent field names.
- Use $lookup only when the join is explicitly needed.
- Pipeline order: $match → $lookup → $unwind → $group → $project → $sort → $limit
- Never use $function, $merge, $out, $where
- If the schema cannot answer the request: needsData=false, pipeline=[]

INTENTS:
- dashboard        → needsChart: true
- report           → needsChart: false
- general_question → needsChart: false
- Never return "inquiry" — use "general_question"

Return JSON only:
{ intent, needsData, needsEnrichment, needsChart, query, pipeline, chartHint }
`;

export async function runSupervisorPlan({
  prompt,
  intent,
  sourceName,
  sources,
}: {
  prompt:      string;
  intent:      IntentKind;
  sourceName?: string;
  sources:     DataSource[];
}) {
  if (!sources.length) {
    throw new Error(
      'No data sources configured. Register at least one dataset via POST /api/sources.',
    );
  }

  const compact = compactSources(sources, sourceName);
  log('supervisor-plan', `LLM call → model: llama-3.3-70b | intent: ${intent} | sources: [${compact.map((s: { name: string }) => s.name).join(', ')}]`);
  log('supervisor-plan', `prompt sent to LLM: "${prompt}"`);

  const { text } = await generateText({
    model:       resolveModel('supervisor'),
    maxTokens:   900,
    temperature: 0,
    messages: [
      { role: 'system', content: INSTRUCTIONS },
      {
        role:    'user',
        content: JSON.stringify({
          prompt,
          intent,
          sourceName,
          availableSources: compact,
        }),
      },
    ],
  });

  const plan = parseJsonOutput(
    text.replace(PLAN_INTENT_FIX, '"intent": "general_question"')
  ) as TaskPlan;

  log('supervisor-plan', `pipeline built | stages: ${plan.pipeline?.length ?? 0} | needsData: ${plan.needsData}`, plan.pipeline);

  return finalizeTaskPlan({ plan, availableSources: sources, forcedIntent: intent });
}

function compactSources(sources: DataSource[], filterName?: string) {
  const token    = normalizeToken(filterName);
  const filtered = token
    ? sources.filter(s => normalizeToken(s.name) === token || normalizeToken(s.collection) === token)
    : [];
  const list = filtered.length ? filtered : sources;

  return list.map(source => {
    const relationships = [
      ...(source.joins ?? []).map(join => ({
        fromCollection: source.collection,
        localField:     join.localField,
        toCollection:   join.from,
        foreignField:   join.foreignField,
        alias:          join.as,
      })),
      ...source.fields.flatMap(field => {
        if (!field.referenceTo) return [];
        const [toCollection, foreignField = 'id'] = field.referenceTo.split('.');
        return [{ fromCollection: source.collection, localField: field.name, toCollection, foreignField, alias: toCollection }];
      }),
    ];

    return {
      name:       source.name,
      collection: source.collection,
      ...(source.description       ? { description:  source.description }  : {}),
      ...(source.joins?.length     ? { joins:         source.joins }        : {}),
      ...(relationships.length     ? { relationships }                      : {}),
      fields: source.fields.map(field => ({
        name: field.name,
        type: field.type,
        role: field.role,
        ...(field.description        ? { description:  field.description }  : {}),
        ...(field.referenceTo        ? { referenceTo:  field.referenceTo }  : {}),
        ...(field.enumValues?.length ? { enumValues:   field.enumValues }   : {}),
      })),
    };
  });
}
