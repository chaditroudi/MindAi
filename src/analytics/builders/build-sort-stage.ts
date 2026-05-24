import type { TaskPlan } from '../../types/index.js';

export function buildSortStage(plan: TaskPlan): Record<string, unknown> | undefined {
  if (plan.query.topN) return { $sort: { value: -1 } };
  if (!plan.query.sort?.length) return undefined;

  const sortStage: Record<string, 1 | -1> = {};
  for (const sort of plan.query.sort) sortStage[sort.field] = sort.dir === 'asc' ? 1 : -1;
  return { $sort: sortStage };
}
