import type { DataStore, TaskPlan } from '../../types/index.js';
import { getTemporalFields } from '../helpers/get-temporal-fields.js';

export function validateTimeFields(plan: TaskPlan, dataStore: DataStore): TaskPlan {
  const allowed = new Set(getTemporalFields(dataStore).map((field) => field.name));
  const timeRange =
    plan.query.timeRange && allowed.has(plan.query.timeRange.field)
      ? plan.query.timeRange
      : undefined;

  return {
    ...plan,
    query: {
      ...plan.query,
      timeRange,
    },
  };
}
