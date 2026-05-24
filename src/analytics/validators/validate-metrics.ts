import type { DataStore, TaskPlan } from '../../types/index.js';
import { getMeasures } from '../helpers/get-measures.js';

export function validateMetrics(plan: TaskPlan, dataStore: DataStore): TaskPlan {
  const allowed = new Set(getMeasures(dataStore).map((field) => field.name));
  const metric = plan.query.metric && allowed.has(plan.query.metric) ? plan.query.metric : undefined;
  const metrics = plan.query.metrics?.filter((candidate) => allowed.has(candidate));

  return {
    ...plan,
    query: {
      ...plan.query,
      metric,
      metrics: metrics && metrics.length > 0 ? [...new Set(metrics)] : undefined,
    },
  };
}
