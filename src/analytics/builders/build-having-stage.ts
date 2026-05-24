import type { TaskPlan } from '../../types/index.js';

const havingOpMap: Record<string, string> = {
  gt: '$gt',
  gte: '$gte',
  lt: '$lt',
  lte: '$lte',
  eq: '$eq',
};

export function buildHavingStage(plan: TaskPlan): Record<string, unknown> | undefined {
  const having = plan.query.having;
  if (!having) return undefined;

  return { $match: { [having.field]: { [havingOpMap[having.op]]: having.value } } };
}
