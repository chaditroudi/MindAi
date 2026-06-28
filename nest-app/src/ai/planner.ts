import { generateObject } from 'ai';
import type { CoreMessage } from 'ai';
import type { TokenUsage } from './token';
import { z } from 'zod';
import { resolveModel, freshSignal } from './model';
import { interpolateTemplate, readMarkdownSection, skillFile } from './skill-prompt';
import { normalizeToken } from '../sources/sources-cache';
import { log, logTrace } from '../common/logger/app.logger';
import type { DataSource, DataSourceField, TaskPlan, IntentKind } from '../types';

const skillPath                  = skillFile('aggregation', 'SKILL.md');
const AGGREGATION_PROMPT_BASE    = readMarkdownSection(skillPath, 'Runtime Prompt');
const AGGREGATION_PROMPT_DASH    = readMarkdownSection(skillPath, 'Runtime Prompt Dashboard');
const AGGREGATION_PROMPT_NONDASH = readMarkdownSection(skillPath, 'Runtime Prompt Non-Dashboard');

export const PLANNER_STRATEGIES       = ['standard', 'trend', 'comparison', 'anomaly', 'overview'] as const;
export const PLANNER_DEFAULT_STRATEGY = 'standard';

const MAX_TOKENS    = Number(process.env['PLANNER_MAX_TOKENS'] ?? 600);
const STRATEGY_ENUM = z.enum([...PLANNER_STRATEGIES]);

function fieldDesc(f: DataSourceField): string | undefined {
  return f.description ?? (f as unknown as Record<string, unknown>)['desc'] as string | undefined;
}

function resolveReference(field: DataSourceField, sources: DataSource[]): DataSource | undefined {
  const desc = fieldDesc(field)?.toLowerCase() ?? '';
  const fn   = field.name.toLowerCase();
  if (field.referenceTo) {
    return sources.find(s => s.name === field.referenceTo || s.collection === field.referenceTo);
  }
  const byDesc = /reference| id|ref /.test(desc)
    && sources.find(s => desc.includes(s.name.toLowerCase()) || desc.includes(s.collection.toLowerCase()));
  if (byDesc) return byDesc;
  return sources.find(s => {
    const col = s.collection.toLowerCase().replace(/s$/, '');
    const nm  = s.name.toLowerCase().replace(/s$/, '');
    return col.startsWith(fn) || nm.startsWith(fn) || fn.startsWith(col) || fn.startsWith(nm);
  });
}

function buildSchemaSection(sources: DataSource[]): string {
  if (!sources.length) return '\nNo data sources — return needsData=false.';

  const lines: string[] = [
    '',
    '══════════════════════════════════════════════════════════',
    'YOUR DATABASE SCHEMA',
    '  Every "$fieldName" in the pipeline MUST appear here.',
    '  Never use a name from the user prompt — only names listed below.',
    '══════════════════════════════════════════════════════════',
  ];

  for (const source of sources) {
    const refByField = new Map(source.fields.map(f => [f, resolveReference(f, sources)]));
    const metrics  = source.fields.filter(f => f.type === 'number' || f.type === 'integer');
    const temporal = source.fields.filter(f =>
      f.type === 'date' || f.type === 'datetime' || f.role === 'temporal' ||
      ['year', 'month', 'quarter', 'date'].some(t => f.name.toLowerCase().includes(t)),
    );
    const dims = source.fields.filter(f => f.type === 'string' || f.type === 'enum' || f.type === 'text');

    lines.push('', `Collection: "${source.collection}"   →   query.sourceName = "${source.name}"`);
    if (source.description) lines.push(`  ${source.description}`);
    lines.push('  Fields:');

    for (const field of source.fields) {
      const ref  = refByField.get(field);
      const desc = fieldDesc(field);
      const tags = [
        field.type,
        metrics.includes(field)      && 'measure',
        temporal.includes(field)     && 'temporal',
        dims.includes(field) && !ref && 'dimension',
        ref                          && `→ references ${ref.collection}`,
        desc,
      ].filter((t): t is string => typeof t === 'string' && t.length > 0);
      lines.push(`    "${field.name}"  (${[...new Set(tags)].join(' | ')})`);
      if (field.enumValues?.length) {
        lines.push(`      allowed values: ${field.enumValues.map(v => `"${v}"`).join(' | ')}`);
      } else if (field.sampleValues?.length) {
        lines.push(`      sample values: ${field.sampleValues.slice(0, 5).map(v => JSON.stringify(v)).join(', ')}`);
      }
    }

    // Build available joins from explicit source.joins + auto-detected field references
    const joins: Array<{ from: string; localField: string; foreignField: string; as: string }> = [];

    for (const j of source.joins ?? []) {
      joins.push(j);
    }
    for (const field of source.fields) {
      const ref = refByField.get(field);
      if (!ref) continue;
      if (joins.some(j => j.localField === field.name && j.from === ref.collection)) continue;
      joins.push({ from: ref.collection, localField: field.name, foreignField: '_id', as: ref.name });
    }

    if (joins.length) {
      lines.push('  Available joins (copy $lookup exactly as shown):');
      for (const j of joins) {
        lines.push(
          `    { "$lookup": { "from": "${j.from}", "localField": "${j.localField}", "foreignField": "${j.foreignField}", "as": "${j.as}" } }`,
          `    → then { "$unwind": "$${j.as}" }  →  access as "${j.as}.fieldName"`,
        );
      }
    }
  }

  return lines.join('\n');
}

function buildPlannerPrompt(intent: IntentKind, sources: DataSource[]): string {
  return interpolateTemplate(AGGREGATION_PROMPT_BASE, {
    '{{DATABASE_SCHEMA}}': buildSchemaSection(sources),
    '{{INTENT_GUIDANCE}}': intent === 'dashboard' ? AGGREGATION_PROMPT_DASH : AGGREGATION_PROMPT_NONDASH,
    '{{TODAY}}':           new Date().toISOString().slice(0, 10),
  });
}

function strategySchema() {
  return z.preprocess(
    value => typeof value === 'string' ? value.trim().toLowerCase() : value,
    STRATEGY_ENUM,
  );
}

function buildPlanSchema(intent: IntentKind) {
  const base = z.object({
    needsData: z.boolean(),
    query: z.object({
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
  userModel,
  userProvider,
  hint,
  maxTokens,
}: {
  prompt:        string;
  intent:        IntentKind;
  sources:       DataSource[];
  context?:      CoreMessage[];
  apiKey?:       string;
  userModel?:    string;
  userProvider?: string;
  hint?:         string;
  maxTokens?:    number;
}): Promise<{ plan: TaskPlan; usage: TokenUsage }> {
  const start = Date.now();
  log('planner', `LLM call | intent: ${intent} | sources: ${sources.length} | context: ${context.length}${hint ? ' | retry' : ''} | prompt: "${prompt}"`);

  const userContent = hint
    ? `${JSON.stringify({ prompt, intent })}\n\nPREVIOUS ATTEMPT FAILED — ${hint}`
    : JSON.stringify({ prompt, intent });

  const { object, usage } = await generateObject({
    model:       resolveModel('supervisor', apiKey, userModel, userProvider),
    abortSignal: freshSignal('supervisor'),
    schema:      buildPlanSchema(intent),
    mode:        'json',
    temperature: 0,
    maxRetries:  1,
    maxTokens:   maxTokens ?? MAX_TOKENS,
    system:      buildPlannerPrompt(intent, sources),
    messages: [
      ...context,
      { role: 'user', content: userContent },
    ],
  });

  const { strategy, chartHint } = object as { strategy?: string; chartHint?: string };
  log('planner', `done in ${Date.now() - start}ms | strategy: ${strategy ?? '-'} | chartHint: ${chartHint ?? '-'} | stages: ${object.pipeline.length} | in:${usage.promptTokens} out:${usage.completionTokens}`);
  logTrace('planner', `generated plan`, object);

  return {
    plan:  finalizeTaskPlan({ plan: object as TaskPlan, intent, availableSources: sources }),
    usage: { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens },
  };
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
  const token = normalizeToken(plan.query.sourceName);
  const source = availableSources.find(s =>
    normalizeToken(s.name) === token || normalizeToken(s.collection) === token,
  );

  return {
    ...plan,
    query: {
      ...plan.query,
      sourceName: source?.name ?? plan.query.sourceName,
    },
    skills: deriveExecutionSkills(plan, intent),
  };
}

function deriveExecutionSkills(
  plan:   Pick<TaskPlan, 'needsData' | 'wantChart'>,
  intent: IntentKind,
): TaskPlan['skills'] {
  if (!plan.needsData) return [];
  if (intent === 'dashboard') return ['aggregation', 'chart'];
  if (intent === 'report') return plan.wantChart
    ? ['aggregation', 'report', 'chart']
    : ['aggregation', 'report'];
  return ['aggregation', 'inquiry'];
}
