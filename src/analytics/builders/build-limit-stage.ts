import type { TaskPlan } from '../../types/index.js';

export const DEFAULT_LIMIT = 1000;
export const MAX_LIMIT = 5000;

export function buildLimitStage(plan: TaskPlan): Record<string, unknown> {
  return { $limit: normalizeLimit(plan.query.topN ?? plan.query.limit) };
}

export function normalizeLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(limit, MAX_LIMIT);
}
