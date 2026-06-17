// Agent-path aggregation — used only by session/agent.ts (Mastra free-text routing).
// The primary analytics path uses PipelineService (DI) instead.
import mongoose from 'mongoose';
import { runSupervisorPlan } from '../ai/planner';
import { getSources } from '../sources/sources-cache';
import { normalizeToken } from '../sources/source.repository';
import { log, logTrace } from '../common/logger/app.logger';
import { getCached, setCached } from '../cache/prompt-cache';
import type { IntentKind, DataSource, TaskPlan } from '../types';
import type { CoreMessage } from 'ai';

export interface AggregationResult {
  plan: TaskPlan;
  rows: Record<string, unknown>[];
}

const FORBIDDEN_STAGES = new Set(['$function', '$merge', '$out', '$where', '$eval']);

async function checkCache(intent: IntentKind, prompt: string, context: CoreMessage[]): Promise<AggregationResult | null> {
  if (context.length > 0) return null;
  const cached = await getCached<AggregationResult>(intent, prompt);
  if (cached) log('pipeline', `cache hit | intent: ${intent} | rows: ${cached.rows.length}`);
  return cached ?? null;
}

async function buildPlan(
  prompt: string, intent: IntentKind, sources: DataSource[], context: CoreMessage[], apiKey?: string,
): Promise<TaskPlan> {
  const plan = await runSupervisorPlan({ prompt, intent, sources, context, apiKey });
  log('pipeline', `plan built | skills: [${plan.skills.join(', ')}] | needsData: ${plan.needsData}`);
  logTrace('pipeline', `plan pipeline`, plan.pipeline);
  return plan;
}

function resolvePipeline(
  plan: TaskPlan, sources: DataSource[],
): { pipeline: Record<string, unknown>[]; collection: string } | null {
  if (!plan.skills.includes('aggregation') || !plan.pipeline?.length) return null;
  const token  = normalizeToken(plan.query.sourceName ?? '');
  const source = sources.find(s => normalizeToken(s.name) === token || normalizeToken(s.collection) === token);
  if (!source?.collection && !plan.query.sourceName) return null;
  const col = source?.collection ?? plan.query.sourceName!;
  for (const stage of plan.pipeline) {
    const op = Object.keys(stage)[0];
    if (op && FORBIDDEN_STAGES.has(op)) throw new Error(`Pipeline stage "${op}" is not permitted`);
  }
  return { pipeline: plan.pipeline, collection: col };
}

async function runPipeline(pipeline: Record<string, unknown>[], col: string): Promise<Record<string, unknown>[]> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB not connected');
  const timeoutMs = Number(process.env['MONGODB_PIPELINE_TIMEOUT_MS']) || 30_000;
  return db.collection(col).aggregate(pipeline, { allowDiskUse: true, maxTimeMS: timeoutMs })
    .toArray() as Promise<Record<string, unknown>[]>;
}

export async function aggregate(
  prompt: string, intent: IntentKind, context: CoreMessage[] = [], apiKey?: string,
): Promise<AggregationResult> {
  const sources = getSources();

  const cached = await checkCache(intent, prompt, context);
  if (cached) return cached;

  const plan = await buildPlan(prompt, intent, sources, context, apiKey);
  const validated = resolvePipeline(plan, sources);
  if (!validated) return { plan, rows: [] };

  const rows = await runPipeline(validated.pipeline, validated.collection);
  log('pipeline', `result | collection: ${validated.collection} | rows: ${rows.length}`);

  if (rows.length) {
    setCached(intent, prompt, { plan, rows })
      .catch(err => log('pipeline', `cache write failed: ${err}`));
  }
  return { plan, rows };
}
