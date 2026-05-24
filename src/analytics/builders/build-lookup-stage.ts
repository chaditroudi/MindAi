import type { TaskPlan } from '../../types/index.js';

export function buildLookupStages(plan: TaskPlan): Record<string, unknown>[] {
  return (plan.query.lookups ?? []).flatMap((lookup) => [
    {
      $lookup: {
        from: lookup.from,
        localField: lookup.localField,
        foreignField: lookup.foreignField,
        as: lookup.as,
      },
    },
    {
      $unwind: { path: `$${lookup.as}`, preserveNullAndEmptyArrays: true },
    },
  ]);
}
