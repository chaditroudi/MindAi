import type { Mastra } from '@mastra/core/mastra';
import { z } from 'zod';
import { blueprintRepo } from '../../db/blueprint.repository.js';
import { getKnowledgePromptContext } from '../../knowledge/export-knowledge.js';
import { log } from '../../observability/log.js';
import { taskPlanSchema } from '../schemas/intent.js';
import { finalizeTaskPlan } from '../task-plan.js';
import type { PermissionScope } from '../../types/index.js';

export async function runSupervisorPlan({
  mastra,
  prompt,
  intent,
  scope,
  topic,
  blueprintId,
}: {
  mastra: Mastra;
  prompt: string;
  intent: 'general_question' | 'report' | 'dashboard';
  scope: PermissionScope;
  topic?: string;
  blueprintId?: string;
}) {
  const supervisor = mastra.getAgent('supervisorAgent');
  const blueprints = await blueprintRepo.listAccessible(scope.allowedBlueprintIds);
  const knowledgeContext = getKnowledgePromptContext(prompt, 4);
  const payload = {
    prompt,
    intent,
    currentDate: new Date().toISOString(),
    topic,
    blueprintId,
    platform: { blueprints },
    knowledgeContext,
    scope: {
      tenantId: scope.tenantId,
      allowedBlueprintIds: scope.allowedBlueprintIds,
    },
  };
  const messages = [
    {
      role: 'user' as const,
      content: JSON.stringify(payload),
    },
  ];
  let plan: z.infer<typeof taskPlanSchema>;

  try {
    const planResult = await supervisor.generate(messages, {
      output: taskPlanSchema,
      maxTokens: 1200,
      temperature: 0,
    });
    plan = planResult.object as z.infer<typeof taskPlanSchema>;
  } catch (error) {
    log.warn('supervisor.plan.retry', {
      agent: 'supervisorAgent',
      tenantId: scope.tenantId,
      intent,
      err: error instanceof Error ? error.message : String(error),
    });
    const retry = await supervisor.generate(
      [
        {
          role: 'user',
          content:
            'Your previous response was invalid JSON. Regenerate the TaskPlan now. Return exactly one valid JSON object, with no markdown, comments, code fence, or explanatory text.',
        },
        ...messages,
      ],
      { output: taskPlanSchema, maxTokens: 1200, temperature: 0 },
    );
    plan = retry.object as z.infer<typeof taskPlanSchema>;
  }

  return finalizeTaskPlan({
    plan,
    prompt,
    availableBlueprints: blueprints,
    forcedIntent: intent,
  }) as z.infer<typeof taskPlanSchema>;
}
