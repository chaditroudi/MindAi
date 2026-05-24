import type { TaskPlan } from '../../types/index.js';
import { getPlanMetrics } from './build-group-stage.js';

export function buildProjectStage(plan: TaskPlan): Record<string, unknown> | undefined {
  const dimensions = plan.query.dimensions ?? [];
  if (dimensions.length === 0 && !plan.query.aggregation) return undefined;

  const projection: Record<string, unknown> = { _id: 0, value: 1 };
  for (const dimension of dimensions) projection[dimension] = `$_id.${dimension}`;

  const metrics = getPlanMetrics(plan);
  for (let index = 1; index < metrics.length; index += 1) {
    projection[metrics[index]] = 1;
  }

  return { $project: projection };
}
