import { generateObject } from 'ai';
import type { CoreMessage } from 'ai';
import { z } from 'zod';
import { resolveModel, freshSignal } from './model.js';
import { normalizeToken } from '../db/source.repository.js';
import { log, logTrace } from '../utils/logger.js';
import { buildPlannerPrompt } from '../prompts/planner.prompt.js';
import type { DataSource, TaskPlan, IntentKind } from '../types/index.js';


const MAX_TOKENS = Number(process.env.PLANNER_MAX_TOKENS ?? 900);

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
      strategy:  z.enum(['standard', 'trend', 'comparison', 'anomaly', 'overview']).default('standard'),
      chartHint: z.enum(['ranking', 'distribution', 'trend', 'part_of_whole', 'compare', 'scatter'])
                   .catch('distribution')
                   .default('distribution'),
    });
  }

  if (intent === 'report') {
    return base.extend({
      wantChart: z.boolean().default(false),
      strategy:  z.enum(['standard', 'trend', 'comparison', 'anomaly', 'overview']).optional(),
      chartHint: z.enum(['ranking', 'distribution', 'trend', 'part_of_whole', 'compare', 'scatter']).optional(),
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
  model,
  provider,
}: {
  prompt:    string;
  intent:    IntentKind;
  sources:   DataSource[];
  context?:  CoreMessage[];
  apiKey?:   string;
  model?:    string;
  provider?: string;
}): Promise<TaskPlan> {
  const start = Date.now();
  log('planner', `LLM call | intent: ${intent} | sources: ${sources.length} | context: ${context.length} | prompt: "${prompt}"`);

  const { object } = await generateObject({
    model:       resolveModel('supervisor', apiKey, model, provider),
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

function deriveExecutionSkills(
  plan:   Pick<TaskPlan, 'needsData' | 'wantChart'>,
  intent: IntentKind,
): TaskPlan['skills'] {
  if (!plan.needsData) return [];
  if (intent === 'dashboard') return ['aggregation', 'chart'];
  if (intent === 'report') return plan.wantChart ? ['aggregation', 'report', 'chart'] : ['aggregation', 'report'];
  return ['aggregation', 'inquiry'];
}
