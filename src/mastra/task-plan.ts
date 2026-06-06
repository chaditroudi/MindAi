import { z } from 'zod';
import { taskPlanSchema } from './schemas/intent.js';
import type { DataSource } from '../types/index.js';

type TaskPlan = z.infer<typeof taskPlanSchema>;

export function finalizeTaskPlan({
  plan,
  availableSources,
  forcedIntent,
}: {
  plan: TaskPlan;
  prompt?: string;
  availableSources: DataSource[];
  forcedIntent?: TaskPlan['intent'];
}): TaskPlan {
  const requestedSource = plan.query.sourceName;
  const source = availableSources.find(
    (ds) =>
      normalize(ds.name) === normalize(requestedSource) ||
      normalize(ds.collection) === normalize(requestedSource),
  );

  return {
    ...plan,
    intent: forcedIntent ?? plan.intent,
    needsEnrichment: false,
    needsChart: forcedIntent === 'dashboard' ? true : plan.needsChart,
    query: {
      ...plan.query,
      sourceName: source?.name ?? requestedSource,
    },
  };
}

function normalize(v: string | undefined) {
  return v?.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}
