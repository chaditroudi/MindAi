import type { DataStore, TaskPlan } from '../../types/index.js';
import { getTemporalFields } from '../helpers/get-temporal-fields.js';

const aggOpMap: Record<string, string> = {
  sum: '$sum',
  avg: '$avg',
  min: '$min',
  max: '$max',
};

export function buildGroupStage(
  plan: TaskPlan,
  dataStore: DataStore,
): Record<string, unknown> | undefined {
  const dimensions = plan.query.dimensions ?? [];
  const aggregation = plan.query.aggregation;
  if (dimensions.length === 0 && !aggregation) return undefined;

  const groupId: Record<string, unknown> = {};
  const temporalFields = new Set(getTemporalFields(dataStore).map((field) => field.name));
  for (const dimension of dimensions) {
    groupId[dimension] = temporalFields.has(dimension)
      ? { $dateToString: { format: '%Y-%m-%d', date: `$${dimension}`, timezone: 'UTC' } }
      : `$${dimension}`;
  }

  const groupStage: Record<string, unknown> = {
    _id: dimensions.length > 0 ? groupId : null,
  };

  const metrics = getPlanMetrics(plan);
  if (!aggregation || aggregation === 'count') {
    groupStage.value = { $sum: 1 };
  } else {
    const aggOp = aggOpMap[aggregation];
    groupStage.value = metrics[0] ? { [aggOp]: `$${metrics[0]}` } : { $sum: 1 };
    for (let index = 1; index < metrics.length; index += 1) {
      groupStage[metrics[index]] = { [aggOp]: `$${metrics[index]}` };
    }
  }

  return { $group: groupStage };
}

export function getPlanMetrics(plan: TaskPlan): string[] {
  return plan.query.metrics?.length
    ? plan.query.metrics
    : plan.query.metric
      ? [plan.query.metric]
      : [];
}
