import { generateText } from 'ai';
import { resolveModel } from '../model.js';
import { finalizeTaskPlan } from '../task-plan.js';
import { PRINCIPAL_SUPERVISOR_SOURCES } from '../../config/principal-supervisor-structure.js';
import { normalizeToken } from '../../db/source.repository.js';
import { parseJsonOutput } from '../../utils/json-output.js';
import type { DataSource, TaskPlan, IntentKind } from '../../types/index.js';

const PLAN_INTENT_FIX = /"intent"\s*:\s*"inquiry"/;

const INSTRUCTIONS = `
You are the analytics supervisor.
Return one valid TaskPlan JSON with a safe aggregation pipeline.

Use availableSources only as schema input. Never invent collections, fields, joins, enum values, or date fields.
If the schema cannot support the request, return needsData=false and pipeline=[].

Rules:
- Pick one root source and set query.sourceName to that source name.
- Use $lookup only when the schema explicitly allows it.
- count => $sum: 1
- sum   => $sum: "$field"
- avg   => $avg: "$field"
- list  => raw fetch with $limit 50
- top N => $sort + $limit with chartHint "ranking"
- trend => use a valid temporal field

Pipeline order: $match → $lookup → $unwind → $group → $project → $sort → $limit

- Never use $function, $merge, $out, $where
- Always project "_id": 0

Intents:
- dashboard        => needsChart: true
- report           => needsChart: false
- general_question => needsChart: false
- never return "inquiry" — use "general_question"

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
  sources?:    DataSource[];
}) {
  const available = sources?.length ? sources : PRINCIPAL_SUPERVISOR_SOURCES;

  const { text } = await generateText({
    model:       resolveModel(),
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
          availableSources: compactSources(available, sourceName),
        }),
      },
    ],
  });

  const plan = parseJsonOutput(
    text.replace(PLAN_INTENT_FIX, '"intent": "general_question"')
  ) as TaskPlan;

  return finalizeTaskPlan({ plan, availableSources: available, forcedIntent: intent });
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
