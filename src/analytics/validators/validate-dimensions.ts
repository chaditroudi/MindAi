import type { DataStore, TaskPlan } from '../../types/index.js';
import { getDimensions } from '../helpers/get-dimensions.js';
import { getTemporalFields } from '../helpers/get-temporal-fields.js';

export function validateDimensions(plan: TaskPlan, dataStore: DataStore): TaskPlan {
  const allowed = new Set([
    ...getDimensions(dataStore).map((field) => field.name),
    ...getTemporalFields(dataStore).map((field) => field.name),
  ]);
  const dimensions = plan.query.dimensions?.filter((candidate) => allowed.has(candidate));

  return {
    ...plan,
    query: {
      ...plan.query,
      dimensions: dimensions && dimensions.length > 0 ? [...new Set(dimensions)] : undefined,
    },
  };
}
