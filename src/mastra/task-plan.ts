import type { DataSource, TaskPlan } from '../types/index.js';

export function finalizeTaskPlan({
  plan,
  availableSources,
  forcedIntent,
}: {
  plan:             TaskPlan;
  availableSources: DataSource[];
  forcedIntent?:    TaskPlan['intent'];
}): TaskPlan {
  const token  = normalize(plan.query.sourceName);
  const source = availableSources.find(s =>
    normalize(s.name) === token || normalize(s.collection) === token
  );

  return {
    ...plan,
    intent:          forcedIntent ?? plan.intent,
    needsEnrichment: false,
    needsChart:      forcedIntent === 'dashboard' ? true : plan.needsChart,
    query: {
      ...plan.query,
      sourceName: source?.name ?? plan.query.sourceName,
    },
  };
}

function normalize(v?: string) {
  return v?.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}
