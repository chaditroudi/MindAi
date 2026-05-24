import type { DataStore, TaskPlan } from '../../types/index.js';
import { validateDimensions } from './validate-dimensions.js';
import { validateLookups } from './validate-lookups.js';
import { validateMetrics } from './validate-metrics.js';
import { validateTimeFields } from './validate-time-fields.js';

export function validateTaskPlan(plan: TaskPlan, dataStore: DataStore): TaskPlan {
  return [validateMetrics, validateDimensions, validateTimeFields, validateLookups].reduce(
    (current, validate) => validate(current, dataStore),
    plan,
  );
}
