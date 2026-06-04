import { Agent } from '@mastra/core/agent';
import type { Mastra } from '@mastra/core/mastra';
import { z } from 'zod';
import { resolveModel } from '../model.js';
import { composeWithSkills } from '../skills/compose.js';
import { queryPlanningSkill } from '../skills/query-planning/index.js';
import { taskPlanSchema } from '../schemas/intent.js';
import { finalizeTaskPlan } from '../task-plan.js';
import {
  PRINCIPAL_SUPERVISOR_DATASTORES,
  PRINCIPAL_SUPERVISOR_SCHEMA_INSTRUCTION,
} from '../../config/principal-supervisor-structure.js';
import { normalizeToken } from '../../db/datastore.repository.js';
import type { DataStore } from '../../types/index.js';
import type { PermissionScope } from '../../types/index.js';
import { parseJsonOutput } from '../../utils/json-output.js';
import { runQueuedLlmCall } from '../../utils/llm-queue.js';
import { envTimeout, withTimeout } from '../../utils/timeout.js';

const BASE_INSTRUCTIONS = `
You are the supervisor for Mind Platform analytics.
Your job is to read the user request and platform.dataStores, then return one valid TaskPlan JSON with a MongoDB aggregation pipeline.

The supervisor builds the aggregation. Do not delegate that logic.

Use platform.dataStores as the only schema source of truth.
Do not invent collections, fields, joins, enum values, or date fields.
If the schema cannot support the request, return needsData=false and pipeline=[].

Principal structure to align with:
${PRINCIPAL_SUPERVISOR_SCHEMA_INSTRUCTION}

Planning rules:
- Pick exactly one root datastore and set query.dataStoreName.
- Use only valid fields from that datastore.
- Use $lookup only when a join is explicitly defined in joins or referenceTo.
- For count questions use $sum: 1.
- For total/sum use $sum on the numeric field.
- For average use $avg on the numeric field.
- For list/show/find use a raw fetch with no $group and limit 50.
- For top N use $sort and $limit with chartHint="ranking".
- For trends use a valid temporal field.

Build the pipeline in this order when needed:
1. $match
2. $lookup
3. $unwind
4. $group
5. $project
6. $sort
7. $limit

Validation rules:
- Every collection must exist in dataStores.
- Every field must exist in the selected datastore.
- Every enum value must exist in enumValues.
- Every lookup must be backed by joins or referenceTo.
- Never include tenantId.
- Never use $function, $merge, $out, or $where.
- Always project "_id": 0 in the final output.

Intent rules:
- dashboard => needsData=true, needsChart=true
- report => needsData=true, needsChart=false unless the user asks for a chart
- inquiry => needsData=true, needsChart=false
- chartHint can be compare, trend, distribution, part_of_whole, geo, or ranking

Return JSON only with these keys:
intent, needsData, needsEnrichment, needsChart, query, pipeline, chartHint
`;

export const supervisorAgent: Agent = new Agent({
  name: 'Supervisor Agent',
  instructions: composeWithSkills(BASE_INSTRUCTIONS, [queryPlanningSkill]),
  model: resolveModel('supervisor'),
});

// ─── Supervisor Runtime ───────────────────────────────────────────────────────

export async function runSupervisorPlan({
  mastra,
  prompt,
  planningPrompt,
  intent,
  scope,
  topic,
  dataStoreName,
  datastores,
}: {
  mastra: Mastra;
  prompt: string;
  planningPrompt?: string;
  intent: 'general_question' | 'report' | 'dashboard';
  scope: PermissionScope;
  topic?: string;
  dataStoreName?: string;
  datastores?: DataStore[];
}) {
  const supervisor = mastra.getAgent('supervisorAgent');
  const dataStores = resolvePlanningDataStores(scope, datastores);
  const plannerPrompt = planningPrompt ?? prompt;
  const payload = {
    prompt: plannerPrompt,
    currentRequest: prompt,
    intent,
    dataStoreName,
    platform: { dataStores: compactDataStores(dataStores, dataStoreName ?? topic) },
  };

  const messages = [
    {
      role: 'system' as const,
      content:
        'Return exactly one valid TaskPlan JSON object. ' +
        'platform.dataStores is the ONLY database schema — never invent collections, fields, joins, enum values, statuses, date fields, or dimensions. ' +
        'Before generating the pipeline: (1) select a datastore, (2) validate every field, (3) validate every lookup, (4) validate every enum value. ' +
        'If any validation fails, return { "needsData": false, "pipeline": [] }. ' +
        'Required keys: intent, needsData, needsEnrichment, needsChart, query, pipeline. No markdown. No prose. JSON only.',
    },
    {
      role: 'user' as const,
      content: JSON.stringify(payload),
    },
  ];

  const planResult = await withTimeout(
    runQueuedLlmCall(() =>
      supervisor.generate(messages, { maxTokens: 900, temperature: 0 }),
    ),
    'supervisor.plan',
    envTimeout('SUPERVISOR_TIMEOUT_MS', 4000),
  );

  const plan = parseJsonOutput(planResult.text, taskPlanSchema);

  return finalizeTaskPlan({
    plan,
    prompt,
    availableDataStores: dataStores,
    forcedIntent: intent,
  }) as z.infer<typeof taskPlanSchema>;
}

function resolvePlanningDataStores(
  scope: PermissionScope,
  datastores?: DataStore[],
) {
  const source = datastores?.length ? datastores : PRINCIPAL_SUPERVISOR_DATASTORES;
  const allowed = new Set((scope.allowedDataStores ?? []).map(normalizeToken).filter(Boolean));
  if (allowed.size === 0) return source;
  const filtered = source.filter(
    (ds) => allowed.has(normalizeToken(ds.name)) || allowed.has(normalizeToken(ds.collection)),
  );
  return filtered.length > 0 ? filtered : source;
}

function compactDataStores(
  dataStores: DataStore[],
  filterName?: string,
) {
  const token = normalizeToken(filterName);
  const filtered = token
    ? dataStores.filter(
        (ds) => normalizeToken(ds.name) === token || normalizeToken(ds.collection) === token,
      )
    : [];
  const list = filtered.length > 0 ? filtered : dataStores;

  return list.map((ds) => {
    // Build explicit relationship list so the LLM reasons from structured data
    // instead of parsing referenceTo strings.
    const relationships = [
      ...(ds.joins ?? []).map((j) => ({
        fromCollection: ds.collection,
        localField: j.localField,
        toCollection: j.from,
        foreignField: j.foreignField,
        alias: j.as,
      })),
      ...ds.fields
        .filter((f) => f.referenceTo)
        .map((f) => {
          const [toCollection, foreignField] = (f.referenceTo ?? '').split('.');
          return {
            fromCollection: ds.collection,
            localField: f.name,
            toCollection,
            foreignField: foreignField ?? 'id',
            alias: toCollection,
          };
        }),
    ];

    return {
      name: ds.name,
      collection: ds.collection,
      ...(ds.description ? { description: ds.description } : {}),
      ...(ds.joins?.length ? { joins: ds.joins } : {}),
      ...(relationships.length ? { relationships } : {}),
      fields: ds.fields.map((f) => ({
        name: f.name,
        type: f.type,
        role: f.role,
        ...(f.description ? { description: f.description } : {}),
        ...(f.referenceTo ? { referenceTo: f.referenceTo } : {}),
        ...(f.enumValues?.length ? { enumValues: f.enumValues } : {}),
      })),
    };
  });
}
