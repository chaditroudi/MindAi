import { generateText } from 'ai';
import { resolveModel } from '../model.js';
import { taskPlanSchema } from '../schemas/intent.js';
import { finalizeTaskPlan } from '../task-plan.js';
import { PRINCIPAL_SUPERVISOR_SOURCES } from '../../config/principal-supervisor-structure.js';
import { normalizeToken } from '../../db/source.repository.js';
import type { DataSource, PermissionScope, TaskPlan } from '../../types/index.js';
import { parseJsonOutput } from '../../utils/json-output.js';
import { runQueuedLlmCall } from '../../utils/llm-queue.js';
import { envTimeout, withTimeout } from '../../utils/timeout.js';

const supervisorModel = resolveModel('supervisor');
const PLAN_INTENT_FIX = /"intent"\s*:\s*"inquiry"/;

export const SUPERVISOR_PLAN_INSTRUCTIONS = `
You are the analytics supervisor.
Return one valid TaskPlan JSON with a safe aggregation pipeline.

Use availableSources only as schema input for the current request.
Treat them as the active datasets/sources. Never invent collections, fields, joins, enum values, or date fields.
If the schema cannot support the request, return needsData=false and pipeline=[].

Rules:
- Pick one root source and set query.sourceName to that selected source name.
- Use $lookup only when the schema explicitly allows it.
- count => $sum: 1
- sum => $sum: "$field"
- avg => $avg: "$field"
- list/find/show => raw fetch with limit 50
- top N => $sort + $limit with chartHint "ranking"
- trend => use a valid temporal field

Pipeline order: $match -> $lookup -> $unwind -> $group -> $project -> $sort -> $limit

Validation:
- every collection, field, enum value, and lookup must exist in the schema
- never include tenantId
- never use $function, $merge, $out, or $where
- always project "_id": 0

Intents:
- dashboard => needsChart=true
- report => needsChart=false
- general_question => needsChart=false
- never return "inquiry"; use "general_question"

Return JSON only with:
intent, needsData, needsEnrichment, needsChart, query, pipeline, chartHint
`;

export async function runSupervisorPlan({
  prompt, planningPrompt, intent, scope, topic, sourceName, sources,
}: {
  prompt: string; planningPrompt?: string; intent: 'general_question' | 'report' | 'dashboard';
  scope: PermissionScope;
  topic?: string;
  sourceName?: string;
  sources?: DataSource[];
}) {
  const resolvedSources = resolvePlanningSources(scope, sources);
  const selectedSourceName = sourceName;
  const messages = [
    { role: 'system' as const, content: SUPERVISOR_PLAN_INSTRUCTIONS },
    {
      role: 'user' as const,
      content: JSON.stringify({
        prompt: planningPrompt ?? prompt,
        currentRequest: prompt,
        intent,
        sourceName: selectedSourceName,
        availableSources: compactSources(resolvedSources, selectedSourceName ?? topic),
      }),
    },
  ];

  const { text } = await withTimeout(
    runQueuedLlmCall(() => generateText({ model: supervisorModel, messages, maxTokens: 900, temperature: 0 })),
    'supervisor.plan',
    envTimeout('SUPERVISOR_TIMEOUT_MS', 4000),
  );

  const plan = parseJsonOutput(text.replace(PLAN_INTENT_FIX, '"intent": "general_question"'), taskPlanSchema) as TaskPlan;
  return finalizeTaskPlan({
    plan,
    prompt,
    availableSources: resolvedSources,
    forcedIntent: intent,
  });
}

function resolvePlanningSources(scope: PermissionScope, sources?: DataSource[]) {
  const sourceList = sources?.length ? sources : PRINCIPAL_SUPERVISOR_SOURCES;
  const allowed = new Set(
    (scope.allowedSources ?? [])
      .map(normalizeToken)
      .filter(Boolean),
  );
  if (allowed.size === 0) return sourceList;
  const filtered = sourceList.filter((source) => allowed.has(normalizeToken(source.name)) || allowed.has(normalizeToken(source.collection)));
  return filtered.length > 0 ? filtered : sourceList;
}

function compactSources(sources: DataSource[], filterName?: string) {
  const token = normalizeToken(filterName);
  const filtered = token ? sources.filter((ds) => normalizeToken(ds.name) === token || normalizeToken(ds.collection) === token) : [];
  const list = filtered.length > 0 ? filtered : sources;

  return list.map((source) => {
    const relationships = [
      ...(source.joins ?? []).map((join) => ({
        fromCollection: source.collection,
        localField: join.localField,
        toCollection: join.from,
        foreignField: join.foreignField,
        alias: join.as,
      })),
      ...source.fields.flatMap((field) => {
        if (!field.referenceTo) return [];
        const [toCollection, foreignField = 'id'] = field.referenceTo.split('.');
        return [{ fromCollection: source.collection, localField: field.name, toCollection, foreignField, alias: toCollection }];
      }),
    ];

    return {
      name: source.name,
      collection: source.collection,
      ...(source.description ? { description: source.description } : {}),
      ...(source.joins?.length ? { joins: source.joins } : {}),
      ...(relationships.length ? { relationships } : {}),
      fields: source.fields.map((field) => ({
        name: field.name,
        type: field.type,
        role: field.role,
        ...(field.description ? { description: field.description } : {}),
        ...(field.referenceTo ? { referenceTo: field.referenceTo } : {}),
        ...(field.enumValues?.length ? { enumValues: field.enumValues } : {}),
      })),
    };
  });
}
