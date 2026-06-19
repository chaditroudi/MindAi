import { generateObject } from 'ai';
import type { CoreMessage } from 'ai';
import { z } from 'zod';
import { resolveModel, freshSignal } from './model';
import { normalizeToken } from '../sources/source.repository';
import { log, logTrace } from '../common/logger/app.logger';
import { buildPlannerPrompt, PLANNER_DEFAULT_STRATEGY, PLANNER_STRATEGIES } from '../prompts/planner.prompt';
import type { DataSource, TaskPlan, IntentKind } from '../types';

const MAX_TOKENS = Number(process.env['PLANNER_MAX_TOKENS'] ?? 600);
const STRATEGY_ENUM = z.enum(PLANNER_STRATEGIES as [string, ...string[]]);

function strategySchema() {
  return z.preprocess(
    value => typeof value === 'string' ? value.trim().toLowerCase() : value,
    STRATEGY_ENUM,
  );
}

// The planner asks the LLM for a typed "task plan" that the rest of the
// pipeline can execute. The schema changes slightly by intent so dashboards
// can require chart metadata while reports can request charts optionally.
function buildPlanSchema(intent: IntentKind) {
  const base = z.object({
    needsData: z.boolean(),
    query:     z.object({
      sourceName: z.string().optional(),
      limit:      z.number().optional(),
    }),
    pipeline: z.array(z.record(z.unknown())).default([]),
  });

  if (intent === 'dashboard') {
    return base.extend({
      strategy:  strategySchema().catch(PLANNER_DEFAULT_STRATEGY).default(PLANNER_DEFAULT_STRATEGY),
      chartHint: z.string().catch('distribution').default('distribution'),
    });
  }

  if (intent === 'report') {
    return base.extend({
      wantChart: z.boolean().default(false),
      strategy:  strategySchema().optional(),
      chartHint: z.string().optional(),
    });
  }

  return base;
}

export async function runSupervisorPlan({
  prompt,
  intent,
  sources,
  context = [],
  apiKey,
}: {
  prompt:   string;
  intent:   IntentKind;
  sources:  DataSource[];
  context?: CoreMessage[];
  apiKey?:  string;
}): Promise<TaskPlan> {
  const start = Date.now();
  log('planner', `LLM call | intent: ${intent} | sources: ${sources.length} | context: ${context.length} | prompt: "${prompt}"`);

  // We force a JSON-shaped response so downstream code can treat the model as
  // a planner that emits structured instructions instead of free-form text.
  const { object } = await generateObject({
    model:       resolveModel('supervisor', apiKey),
    abortSignal: freshSignal('supervisor'),
    schema:      buildPlanSchema(intent),
    mode:        'json',
    temperature: 0,
    maxRetries:  1,
    maxTokens:   MAX_TOKENS,
    system:      buildPlannerPrompt(intent, sources),
    messages: [
      ...context,
      { role: 'user', content: JSON.stringify({ prompt, intent }) },
    ],
  });

  const { strategy, chartHint } = object as { strategy?: string; chartHint?: string };
  log('planner', `done in ${Date.now() - start}ms | strategy: ${strategy ?? '-'} | chartHint: ${chartHint ?? '-'} | stages: ${object.pipeline.length}`);
  logTrace('planner', `generated plan`, object);

  return finalizeTaskPlan({ plan: object as TaskPlan, intent, availableSources: sources });
}

// The LLM may return a fuzzy source identifier, so we map it back to the
// canonical source name from the configured data sources before execution.
function finalizeTaskPlan({
  plan,
  intent,
  availableSources,
}: {
  plan:             TaskPlan;
  intent:           IntentKind;
  availableSources: DataSource[];
}): TaskPlan {
  const token  = normalizeToken(plan.query.sourceName);
  const source = availableSources.find(s =>
    normalizeToken(s.name) === token || normalizeToken(s.collection) === token,
  );

  return {
    ...plan,
    skills: deriveExecutionSkills(plan, intent),
    query: {
      ...plan.query,
      sourceName: source?.name ?? plan.query.sourceName,
    },
  };
}

// Skills are the execution capabilities the next stage should activate based
// on the plan's data needs and the user-facing intent.
function deriveExecutionSkills(
  plan:   Pick<TaskPlan, 'needsData' | 'wantChart'>,
  intent: IntentKind,
): TaskPlan['skills'] {
  if (!plan.needsData) return [];
  if (intent === 'dashboard') return ['aggregation', 'chart'];
  if (intent === 'report') return plan.wantChart ? ['aggregation', 'report', 'chart'] : ['aggregation', 'report'];
  return ['aggregation', 'inquiry'];
}
