import type { DataStore, TaskPlan } from '../../types/index.js';

export function validateLookups(plan: TaskPlan, dataStore: DataStore): TaskPlan {
  const joins = dataStore.joins ?? [];
  const lookups = plan.query.lookups?.filter((lookup) =>
    joins.some(
      (join) =>
        join.from === lookup.from &&
        join.localField === lookup.localField &&
        join.foreignField === lookup.foreignField &&
        join.as === lookup.as,
    ),
  );

  return {
    ...plan,
    query: {
      ...plan.query,
      lookups: lookups && lookups.length > 0 ? lookups : undefined,
    },
  };
}
