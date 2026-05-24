import type { PermissionScope, TaskPlan } from '../../types/index.js';

const filterOpMap: Record<string, string> = {
  eq: '$eq',
  ne: '$ne',
  gt: '$gt',
  gte: '$gte',
  lt: '$lt',
  lte: '$lte',
  in: '$in',
  nin: '$nin',
};

export function buildMatchStage(plan: TaskPlan, scope: PermissionScope): Record<string, unknown> {
  const matchStage: Record<string, unknown> = { tenantId: scope.tenantId };
  if (scope.rowFilter) Object.assign(matchStage, scope.rowFilter);

  for (const filter of plan.query.filters ?? []) {
    if (filter.op === 'regex') {
      matchStage[filter.field] = { $regex: filter.value, $options: 'i' };
      continue;
    }

    matchStage[filter.field] = { [filterOpMap[filter.op]]: filter.value };
  }

  if (plan.query.timeRange) {
    const range: Record<string, unknown> = {};
    if (plan.query.timeRange.from) range.$gte = new Date(plan.query.timeRange.from);
    if (plan.query.timeRange.to) range.$lte = new Date(plan.query.timeRange.to);
    if (Object.keys(range).length > 0) matchStage[plan.query.timeRange.field] = range;
  }

  return { $match: matchStage };
}
