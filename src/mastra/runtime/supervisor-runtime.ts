import type { Mastra } from '@mastra/core/mastra';
import { z } from 'zod';
import { dataStoreRepo } from '../../db/datastore.repository.js';
import { getKnowledgePromptContext } from '../../knowledge/export-knowledge.js';
import { log } from '../../observability/log.js';
import { taskPlanSchema } from '../schemas/intent.js';
import { finalizeTaskPlan } from '../task-plan.js';
import type { PermissionScope } from '../../types/index.js';
import { envTimeout, withTimeout } from './timeout.js';

export async function runSupervisorPlan({
  mastra,
  prompt,
  intent,
  scope,
  topic,
  dataStoreName,
}: {
  mastra: Mastra;
  prompt: string;
  intent: 'general_question' | 'report' | 'dashboard';
  scope: PermissionScope;
  topic?: string;
  dataStoreName?: string;
}) {
  const supervisor = mastra.getAgent('supervisorAgent');
  const dataStores = await dataStoreRepo.listAccessibleDataStores(scope);
  const knowledgeContext = getKnowledgePromptContext(prompt, 2);
  const payload = {
    prompt,
    intent,
    currentDate: new Date().toISOString(),
    topic,
    dataStoreName,
    platform: { dataStores: compactDataStores(dataStores) },
    knowledgeContext,
    scope: {
      tenantId: scope.tenantId,
      allowedDataStores: scope.allowedDataStores,
    },
  };
  const messages = [
    {
      role: 'user' as const,
      content: JSON.stringify(payload),
    },
  ];
  let plan: z.infer<typeof taskPlanSchema>;
  const timeoutMs = envTimeout('SUPERVISOR_TIMEOUT_MS', 4000);

  try {
    const planResult = await withTimeout(
      supervisor.generate(messages, {
        output: taskPlanSchema,
        maxTokens: 700,
        temperature: 0,
      }),
      'supervisor.plan',
      timeoutMs,
    );
    plan = planResult.object as z.infer<typeof taskPlanSchema>;
  } catch (error) {
    log.warn('supervisor.plan.retry', {
      agent: 'supervisorAgent',
      tenantId: scope.tenantId,
      intent,
      err: error instanceof Error ? error.message : String(error),
    });
    try {
      const retry = await withTimeout(
        supervisor.generate(
          [
            {
              role: 'user',
              content:
                'Regenerate the TaskPlan as one compact JSON object. No markdown, no comments, no prose.',
            },
            ...messages,
          ],
          { output: taskPlanSchema, maxTokens: 700, temperature: 0 },
        ),
        'supervisor.plan.retry',
        timeoutMs,
      );
      plan = retry.object as z.infer<typeof taskPlanSchema>;
    } catch (retryError) {
      log.error('supervisor.plan.failed', {
        agent: 'supervisorAgent',
        tenantId: scope.tenantId,
        intent,
        err: retryError instanceof Error ? retryError.message : String(retryError),
      });
      throw retryError;
    }
  }

  return finalizeTaskPlan({
    plan,
    prompt,
    availableDataStores: dataStores,
    forcedIntent: intent,
  }) as z.infer<typeof taskPlanSchema>;
}

function compactDataStores(dataStores: Awaited<ReturnType<typeof dataStoreRepo.listAccessibleDataStores>>) {
  return dataStores.map((dataStore) => ({
    name: dataStore.name,
    collection: dataStore.collection,
    description: dataStore.description,
    fields: dataStore.fields.map((field) => ({
      name: field.name,
      type: field.type,
      role: field.role,
      enumValues: field.enumValues,
    })),
  }));
}
