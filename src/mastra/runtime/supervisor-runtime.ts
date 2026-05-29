import type { Mastra } from '@mastra/core/mastra';
import { z } from 'zod';
import { dataStoreRepo } from '../../db/datastore.repository.js';
import { taskPlanSchema } from '../schemas/intent.js';
import { finalizeTaskPlan } from '../task-plan.js';
import type { PermissionScope } from '../../types/index.js';
import { parseJsonOutput } from './json-output.js';
import { runQueuedLlmCall } from './llm-queue.js';
import { envTimeout, withTimeout } from './timeout.js';

export async function runSupervisorPlan({
  mastra,
  prompt,
  planningPrompt,
  intent,
  scope,
  topic,
  dataStoreName,
}: {
  mastra: Mastra;
  prompt: string;
  planningPrompt?: string;
  intent: 'general_question' | 'report' | 'dashboard';
  scope: PermissionScope;
  topic?: string;
  dataStoreName?: string;
}) {
  const supervisor = mastra.getAgent('supervisorAgent');
  const dataStores = await dataStoreRepo.listAccessibleDataStores(scope);
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
        'Return exactly one JSON object matching TaskPlan. Required top-level keys: intent, needsData, needsEnrichment, needsChart, query. No markdown, no prose, no code fence.',
    },
    {
      role: 'user' as const,
      content: JSON.stringify({
        ...payload,
        requiredOutputExample: {
          intent,
          needsData: true,
          needsEnrichment: false,
          needsChart: intent === 'dashboard',
          query: {
            dataStoreName: dataStoreName ?? 'ServiceRequests',
            aggregation: 'count',
            dimensions: ['municipality'],
          },
        },
      }),
    },
  ];
  const timeoutMs = envTimeout('SUPERVISOR_TIMEOUT_MS', 4000);

  const planResult = await withTimeout(
    runQueuedLlmCall(() =>
      supervisor.generate(messages, {
        maxTokens: 700,
        temperature: 0,
      }),
    ),
    'supervisor.plan',
    timeoutMs,
  );

  const plan = parseJsonOutput(planResult.text, taskPlanSchema);

  return finalizeTaskPlan({
    plan,
    prompt,
    availableDataStores: dataStores,
    forcedIntent: intent,
  }) as z.infer<typeof taskPlanSchema>;
}

function compactDataStores(
  dataStores: Awaited<ReturnType<typeof dataStoreRepo.listAccessibleDataStores>>,
  filterName?: string,
) {
  const token = normalizeToken(filterName);
  const filtered = token
    ? dataStores.filter(
        (ds) => normalizeToken(ds.name) === token || normalizeToken(ds.collection) === token,
      )
    : [];
  const list = filtered.length > 0 ? filtered : dataStores;
  return list.map((dataStore) => ({
    name: dataStore.name,
    collection: dataStore.collection,
    fields: dataStore.fields.map((field) => ({
      name: field.name,
      type: field.type,
      role: field.role,
    })),
  }));
}

function normalizeToken(value: string | undefined) {
  return value?.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}
