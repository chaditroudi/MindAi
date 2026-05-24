import type { DataStore, PermissionScope, TaskPlan } from '../../types/index.js';
import { validateScope } from '../validators/validate-scope.js';
import { validateTaskPlan } from '../validators/validate-task-plan.js';
import { buildGroupStage } from './build-group-stage.js';
import { buildHavingStage } from './build-having-stage.js';
import { buildLimitStage } from './build-limit-stage.js';
import { buildLookupStages } from './build-lookup-stage.js';
import { buildMatchStage } from './build-match-stage.js';
import { buildPercentStages } from './build-percent-stage.js';
import { buildProjectStage } from './build-project-stage.js';
import { buildSortStage } from './build-sort-stage.js';

export function buildPipeline({
  plan,
  dataStore,
  scope,
}: {
  plan: TaskPlan;
  dataStore: DataStore;
  scope: PermissionScope;
}) {
  validateScope(dataStore, scope);
  const validatedPlan = validateTaskPlan(plan, dataStore);
  const pipeline: Record<string, unknown>[] = [
    buildMatchStage(validatedPlan, scope),
    ...buildLookupStages(validatedPlan),
  ];

  const groupStage = buildGroupStage(validatedPlan, dataStore);
  if (groupStage) pipeline.push(groupStage);

  const havingStage = buildHavingStage(validatedPlan);
  if (havingStage) pipeline.push(havingStage);

  const projectStage = buildProjectStage(validatedPlan);
  if (projectStage) pipeline.push(projectStage);

  pipeline.push(...buildPercentStages(validatedPlan));

  const sortStage = buildSortStage(validatedPlan);
  if (sortStage) pipeline.push(sortStage);

  pipeline.push(buildLimitStage(validatedPlan));

  return { pipeline, collection: dataStore.collection, plan: validatedPlan };
}
