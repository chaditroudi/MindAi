import { z } from 'zod';
import { taskPlanSchema } from './schemas/intent.js';
import type { DataStore } from '../types/index.js';

type TaskPlan = z.infer<typeof taskPlanSchema>;

export function finalizeTaskPlan({
  plan,
  availableDataStores,
  forcedIntent,
}: {
  plan: TaskPlan;
  prompt?: string;
  availableDataStores: DataStore[];
  forcedIntent?: TaskPlan['intent'];
}): TaskPlan {
  const dataStore = availableDataStores.find(
    (ds) =>
      normalize(ds.name) === normalize(plan.query.dataStoreName) ||
      normalize(ds.collection) === normalize(plan.query.dataStoreName),
  );

  return {
    ...plan,
    intent: forcedIntent ?? plan.intent,
    needsEnrichment: false,
    needsChart: forcedIntent === 'dashboard' ? true : plan.needsChart,
    query: {
      ...plan.query,
      dataStoreName: dataStore?.name ?? plan.query.dataStoreName,
    },
  };
}

function normalize(v: string | undefined) {
  return v?.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}
