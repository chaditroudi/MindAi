import type { Mastra } from '@mastra/core/mastra';
import { z } from 'zod';
import { blueprintRepo } from '../../db/blueprint.repository.js';
import { getKnowledgePromptContext } from '../../knowledge/export-knowledge.js';
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
  const planResult = await supervisor.generate(
    [
      {
        role: 'user',
        content: JSON.stringify({
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
        }),
      },
    ],
    { output: taskPlanSchema, maxTokens: 1200 },
  );

  return finalizeTaskPlan({
    plan: planResult.object as z.infer<typeof taskPlanSchema>,
    prompt,
    availableBlueprints: blueprints,
    forcedIntent: intent,
  }) as z.infer<typeof taskPlanSchema>;
}
