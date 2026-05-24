import type { TaskPlan } from '../../types/index.js';

export function buildPercentStages(plan: TaskPlan): Record<string, unknown>[] {
  if (!plan.query.percentOf) return [];

  return [
    {
      $setWindowFields: {
        sortBy: { value: -1 },
        output: {
          _total: { $sum: '$value', window: { documents: ['unbounded', 'unbounded'] } },
        },
      },
    },
    {
      $addFields: {
        percent: {
          $round: [{ $multiply: [{ $divide: ['$value', '$_total'] }, 100] }, 1],
        },
      },
    },
    { $project: { _total: 0 } },
  ];
}
