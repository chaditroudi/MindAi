import { runSupervisorPlan } from '../ai/planner.js';
import { executePipeline } from '../db/aggregation.js';
import { getSources } from '../db/sources-cache.js';
import { normalizeToken } from '../db/source.repository.js';
import { log, logTrace } from '../utils/logger.js';
import { histRepo } from '../db/results-history.repository.js';
import { getCached, setCached } from '../db/prompt-cache.js';
import type { IntentKind, DataSource, TaskPlan } from '../types/index.js';
import type { CoreMessage } from 'ai';

export interface AggregationResult {
  plan: TaskPlan;
  rows: Record<string, unknown>[];
}

const FORBIDDEN_STAGES = new Set(['$function', '$merge', '$out', '$where', '$eval']);

// -- internal step functions --

async function checkCache(
  intent:   IntentKind,
  prompt:   string,
  context:  CoreMessage[],
): Promise<AggregationResult | null> {
  if (context.length > 0) return null;
  const cached = await getCached<AggregationResult>(intent, prompt);
  if (cached) log('pipeline', `cache hit | intent: ${intent} | rows: ${cached.rows.length}`);
  return cached ?? null;
}

async function buildPlan(
  prompt:  string,
  intent:  IntentKind,
  sources: DataSource[],
  context: CoreMessage[],
  apiKey?: string,
): Promise<TaskPlan> {
  const plan = await runSupervisorPlan({ prompt, intent, sources, context, apiKey });
  log('pipeline', `plan built | skills: [${plan.skills.join(', ')}] | needsData: ${plan.needsData} | source: ${plan.query.sourceName ?? '—'} | stages: ${plan.pipeline?.length ?? 0}`);
  logTrace('pipeline', `plan pipeline`, plan.pipeline);
  return plan;
}

function resolvePipeline(plan: TaskPlan, sources: DataSource[]): { pipeline: Record<string, unknown>[]; collection: string } | null {
  if (!plan.skills.includes('aggregation') || !plan.pipeline?.length) {
    log('pipeline', 'skipping pipeline — no aggregation skill or empty pipeline');
    return null;
  }

  const token  = normalizeToken(plan.query.sourceName);
  const source = sources.find(s => normalizeToken(s.name) === token || normalizeToken(s.collection) === token);
  if (!source?.collection && !plan.query.sourceName) {
    throw new Error('Cannot resolve collection: no source name provided and no matching data source found');
  }
  const collection = source?.collection ?? plan.query.sourceName!;

  for (const stage of plan.pipeline) {
    const op = Object.keys(stage)[0];
    if (op && FORBIDDEN_STAGES.has(op)) throw new Error(`Pipeline stage "${op}" is not permitted`);
  }

  return { pipeline: plan.pipeline, collection };
}

async function runPipeline(pipeline: Record<string, unknown>[], collection: string): Promise<Record<string, unknown>[]> {
  return executePipeline({ pipeline, collection }) as Promise<Record<string, unknown>[]>;
}

function flushResults(
  intent:      IntentKind,
  prompt:      string,
  plan:        TaskPlan,
  collection:  string,
  rows:        Record<string, unknown>[],
  durationMs:  number,
): void {
  if (rows.length) {
    setCached(intent, prompt, { plan, rows })
      .catch(err => log('pipeline', `cache write failed: ${err}`));
  }
  histRepo
    .save({ prompt, intent, collection, pipeline: plan.pipeline!, rows, rowCount: rows.length, durationMs })
    .then(id => { if (id) log('pipeline', `saved to results_history | id: ${id} | rows: ${rows.length}`); })
    .catch(err => log('pipeline', `history save failed: ${err}`));
}


export async function aggregate(
  prompt:  string,
  intent:  IntentKind,
  context: CoreMessage[] = [],
  apiKey?: string,
): Promise<AggregationResult> {
  const t0      = Date.now();
  const sources = getSources();

  const cached = await checkCache(intent, prompt, context);
  if (cached) return cached;

  const plan = await buildPlan(prompt, intent, sources, context, apiKey);

  const validated = resolvePipeline(plan, sources);
  if (!validated) return { plan, rows: [] };

  const { pipeline, collection } = validated;
  const rows = await runPipeline(pipeline, collection);
  const durationMs = Date.now() - t0;

  if (rows.length) {
    const allEmpty = Object.values(rows[0]).every(v => v === null || v === undefined || v === 0 || v === '');
    log('pipeline', `result | collection: ${collection} | rows: ${rows.length} | allEmpty: ${allEmpty}`);
    logTrace('pipeline', `result sample (first 5 rows)`, rows.slice(0, 5));
  } else {
    log('pipeline', `result | collection: ${collection} | rows: 0`);
  }

  flushResults(intent, prompt, plan, collection, rows, durationMs);

  return { plan, rows };
}
