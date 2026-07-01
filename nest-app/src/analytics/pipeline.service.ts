import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import type { CoreMessage } from 'ai';
import { runSupervisorPlan } from '../ai/planner';
import { runChart } from '../ai/chart';
import { runReportSkill, runInquirySkill } from '../ai/writer';
import { addUsage, zeroUsage } from '../ai/token';
import type { TokenUsage } from '../ai/token';
import { getSources, normalizeToken } from '../sources/sources-cache';
import { CacheService } from '../cache/cache.service';
import { HistoryService } from '../history/history.service';
import { ChartResultsRepository } from '../ai/chart-results.repository';
import type { IntentKind, DataSource, TaskPlan, DashboardSpec, ReportSection } from '../types';
import { readJsonSection, skillFile } from '../ai/skill-prompt';

function patchConvert(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(patchConvert);
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('$convert' in obj && obj['$convert'] !== null && typeof obj['$convert'] === 'object') {
      const conv = { ...(obj['$convert'] as Record<string, unknown>) };
      if (conv['to'] === 'date' || conv['to'] === 4) {
        if (!('onError' in conv)) conv['onError'] = null;
        if (!('onNull' in conv)) conv['onNull'] = null;
      }
      return { ...obj, '$convert': conv };
    }
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, patchConvert(v)]));
  }
  return value;
}

type Row              = Record<string, unknown>;
type ResolvedPipeline = { pipeline: Row[]; collection: string };

// Bundles the LLM call parameters shared across all skill dispatches.
export interface LlmOpts {
  apiKey?:    string;
  model?:     string;
  provider?:  string;
  maxTokens?: number;
}

const PLANNER_MAX_TOKENS = Number(process.env['PLANNER_MAX_TOKENS'] ?? 600);
const CHART_MAX_TOKENS   = Number(process.env['CHART_MAX_TOKENS'] ?? 2_000);
const INQUIRY_MAX_TOKENS = Number(process.env['INQUIRY_MAX_TOKENS'] ?? 400);

function clampStageTokens(limit: number | undefined, fallback: number): number | undefined {
  if (!Number.isFinite(fallback) || fallback <= 0) return limit;
  if (!Number.isFinite(limit) || (limit as number) <= 0) return fallback;
  return Math.min(Math.round(limit as number), Math.round(fallback));
}

export interface AggregationResult {
  plan:  TaskPlan;
  rows:  Row[];
  usage: TokenUsage;
}

export interface ReportResult {
  reportSections: ReportSection[];
  chart?:         DashboardSpec;
}

export interface InquiryResult {
  summary: string;
}

export interface ExecuteResult<T> {
  result: T;
  usage:  TokenUsage;
}

// ── Pipeline config — loaded from skills/aggregation/SKILL.md ─────────────────

interface StageBehavior {
  validateKeys: boolean;
  walkValues:   boolean;
  computeKeys:  boolean;
  skipIdKey:    boolean;
  special?:     string;
}

interface PipelineConfig {
  forbiddenStages: string[];
  stageSemantics:  Record<string, StageBehavior>;
}

const pipelineCfg    = readJsonSection<PipelineConfig>(skillFile('aggregation', 'SKILL.md'), 'Pipeline Config');
const FORBIDDEN_STAGES  = new Set(pipelineCfg.forbiddenStages);
const STAGE_BEHAVIORS   = pipelineCfg.stageSemantics;
const DASHBOARD_FULL_INTENT = 'dashboard:full';

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizePipelineStage(
  stage: unknown,
  index: number,
): { stage: Row; strippedKeys: string[] } {
  if (!isPlainRecord(stage)) {
    throw new Error(`Pipeline stage ${index + 1} must be a plain object.`);
  }

  const keys = Object.keys(stage);
  if (!keys.length) {
    throw new Error(`Pipeline stage ${index + 1} must not be empty.`);
  }

  const operatorKeys = keys.filter(key => key.startsWith('$'));
  if (!operatorKeys.length) {
    throw new Error(
      `Pipeline stage ${index + 1} must include exactly one MongoDB operator key starting with "$". ` +
      `Found keys: ${keys.join(', ')}.`,
    );
  }

  if (operatorKeys.length > 1) {
    throw new Error(
      `Pipeline stage ${index + 1} must contain exactly one MongoDB operator key. ` +
      `Found operators: ${operatorKeys.join(', ')}.`,
    );
  }

  const op = operatorKeys[0];
  return {
    stage:        { [op]: stage[op] },
    strippedKeys: keys.filter(key => key !== op),
  };
}

@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  constructor(
    @InjectConnection()
    private readonly connection: Connection,
    private readonly cache:      CacheService,
    private readonly history:    HistoryService,
    private readonly chartRepo:  ChartResultsRepository,
  ) {}

  // ── Core aggregation ────────────────────────────────────────────────────────

  async aggregate(
    prompt:  string,
    intent:  IntentKind,
    context: CoreMessage[] = [],
    opts:    LlmOpts = {},
  ): Promise<AggregationResult> {
    const sources = getSources();
    const dateNow = Date.now();

    if (!context.length) {
      const cached = await this.cache.getCached<AggregationResult>(intent, prompt);
      if (cached) {
        this.logger.log(`cache hit | intent: ${intent} | rows: ${cached.rows.length}`);
        return cached;
      }
    }

    const { plan, rows, collection, usage } = await this.runWithRetry(prompt, intent, sources, context, opts);
    const durationMs = Date.now() - dateNow;
    this.logger.log(`result | collection: ${collection ?? '—'} | rows: ${rows.length} | ${durationMs}ms`);

    if (collection) this.flush(intent, prompt, plan, collection, rows, durationMs);
    return { plan, rows, usage };
  }

  private async runWithRetry(
    prompt:  string,
    intent:  IntentKind,
    sources: DataSource[],
    context: CoreMessage[],
    opts:    LlmOpts,
  ): Promise<{ plan: TaskPlan; rows: Row[]; collection?: string; usage: TokenUsage }> {
    const { apiKey, model: userModel, provider: userProvider, maxTokens } = opts;
    let hint:         string | undefined;
    let plannerUsage: TokenUsage = zeroUsage();
    const plannerMaxTokens = clampStageTokens(maxTokens, PLANNER_MAX_TOKENS);

    for (let attempt = 0; attempt < 2; attempt++) {
      const { plan, usage } = await runSupervisorPlan({
        prompt, intent, sources, context, apiKey, userModel, userProvider, hint, maxTokens: plannerMaxTokens,
      });
      plannerUsage = addUsage(plannerUsage, usage);
      this.logger.log(
        `plan [${attempt + 1}] | skills: [${plan.skills.join(', ')}] | needsData: ${plan.needsData} | source: ${plan.query.sourceName ?? '—'} | stages: ${plan.pipeline?.length ?? 0}`,
      );

      let resolved: ResolvedPipeline | null;
      try {
        resolved = this.resolvePipeline(plan, sources);
        if (resolved) plan.pipeline = resolved.pipeline;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt === 0) {
          hint = this.buildPlanValidationHint(msg);
          continue;
        }
        throw err;
      }

      if (!resolved) return { plan, rows: [], usage: plannerUsage };

      let rows: Row[];
      try {
        rows = await this.runAggregation(resolved.collection, patchConvert(resolved.pipeline) as Row[]);
      } catch (err) {
        const msg   = err instanceof Error ? err.message : String(err);
        const lower = msg.toLowerCase();
        if (attempt === 0) {
          hint = this.buildRetryHint(msg, lower, resolved, sources);
          if (hint) continue;
        }
        throw err;
      }

      if (rows.length === 0 && plan.needsData && attempt === 0 && this.hasStringMatch(resolved.pipeline)) {
        hint = `The pipeline returned 0 rows: ${JSON.stringify(resolved.pipeline)}. ` +
          `The $match filter values may not match actual data — check enum values use exact casing from schema allowed values.`;
        continue;
      }

      return { plan, rows, collection: resolved.collection, usage: plannerUsage };
    }

    throw new Error('Pipeline failed after 2 attempts — check your data source schema and field values.');
  }

  private buildRetryHint(
    msg:      string,
    lower:    string,
    resolved: ResolvedPipeline,
    sources:  DataSource[],
  ): string | undefined {
    if (
      lower.includes('pipeline stage') &&
      (lower.includes('exactly one') || lower.includes('operator key') || lower.includes('non-empty'))
    ) {
      return `Pipeline structure error: "${msg}". Each pipeline item must be exactly one MongoDB stage object like { "$match": { ... } }. Do not merge multiple stages into one object, and do not add commentary keys beside the stage operator.`;
    }

    if (lower.includes('unsupported conversion')) {
      return `MongoDB aggregation error: "${msg}". When converting integer/string fields to dates, always use $convert with onError: null and onNull: null, e.g. { $convert: { input: "$field", to: "date", onError: null, onNull: null } }.`;
    }

    if (lower.includes('exclusion') && lower.includes('inclusion projection')) {
      this.logger.warn(`retrying after MongoDB projection mix error`);
      return `MongoDB aggregation error: "${msg}". In a $project that includes fields (field: 1), you CANNOT also exclude nested fields like "<join>._id": 0 — MongoDB forbids mixing exclusion and inclusion except for the root "_id". Instead, add a separate $unset stage BEFORE $project to remove the joined _id: { "$unset": "<joinAlias>._id" }. Then $project only lists the fields you want (never exclude joined _id there).`;
    }

    if (
      lower.includes('only supports date') ||
      lower.includes('arguments to $date') ||
      (lower.includes('bson type') && lower.includes('date')) ||
      (lower.includes('convert') && lower.includes('to date'))
    ) {
      const src = sources.find(s =>
        s.collection === resolved.collection || s.name === resolved.collection,
      );
      const intTemporalFields = (src?.fields ?? [])
        .filter(f =>
          (f.type === 'integer' || f.type === 'number') &&
          (f.role === 'temporal' || ['year', 'month', 'date', 'day'].some(t => f.name.toLowerCase().includes(t)))
        )
        .map(f => `"${f.name}" (stored as ${f.type}, NOT a Date)`)
        .join(', ');
      this.logger.warn(`retrying after MongoDB date-type error: ${msg}`);
      return (
        `MongoDB aggregation error: "${msg}". ` +
        (intTemporalFields ? `The temporal fields ${intTemporalFields} are plain integers, NOT Date objects. ` : '') +
        `Do NOT use date extraction operators ($year, $month, $dayOfMonth, $dateToString, $dateToParts, $toDate, etc.) on integer or number fields. ` +
        `Instead, reference them directly as numbers: e.g., group by year using "$startYear" as the _id value.`
      );
    }

    return undefined;
  }

  private buildPlanValidationHint(msg: string): string {
    const lower = msg.toLowerCase();
    if (
      lower.includes('pipeline stage') &&
      (lower.includes('exactly one') || lower.includes('operator key') || lower.includes('non-empty'))
    ) {
      return `Pipeline structure failed: ${msg}. Each item in pipeline must be a single MongoDB stage object like { "$match": { ... } }. Do not combine multiple stages or attach extra descriptive keys.`;
    }
    return `Field validation failed: ${msg}. Use only the exact field names listed in the schema — check casing carefully.`;
  }

  private hasStringMatch(pipeline: Row[]): boolean {
    return pipeline.some(stage => {
      const match = stage['$match'] as Record<string, unknown> | undefined;
      if (!match) return false;
      return Object.values(match).some(v => typeof v === 'string');
    });
  }

  private resolvePipeline(plan: TaskPlan, sources: DataSource[]): ResolvedPipeline | null {
    if (!plan.skills.includes('aggregation') || !plan.pipeline?.length) {
      this.logger.log('skipping pipeline — no aggregation skill or empty pipeline');
      return null;
    }

    const token  = normalizeToken(plan.query.sourceName ?? '');
    const source = sources.find(
      s => normalizeToken(s.name) === token || normalizeToken(s.collection) === token,
    );
    if (!source?.collection) {
      const hint = plan.query.sourceName ? ` matching "${plan.query.sourceName}"` : '';
      throw new Error(`No registered data source${hint}. Only registered sources may be queried.`);
    }
    const collection = source.collection;;

    const normalizedPipeline = plan.pipeline.map((stage, index) => {
      const normalized = normalizePipelineStage(stage, index);
      if (normalized.strippedKeys.length) {
        this.logger.warn(
          `pipeline stage ${index + 1}: stripped non-operator keys [${normalized.strippedKeys.join(', ')}]`,
        );
      }
      return normalized.stage;
    });

    for (const stage of normalizedPipeline) {
      const op = Object.keys(stage)[0];
      if (op && FORBIDDEN_STAGES.has(op)) {
        throw new Error(`Pipeline stage "${op}" is not permitted`);
      }
    }

    if (source?.fields?.length) {
      this.validatePipelineFields(normalizedPipeline, source);
    }

    return { pipeline: normalizedPipeline, collection };
  }

  private validatePipelineFields(pipeline: Row[], source: DataSource): void {
    const known    = new Set(['_id', ...source.fields.filter(f => !f.name.startsWith('$')).map(f => f.name)]);
    const computed = new Set<string>();
    const bad:       string[] = [];

    const addBad = (name: string) => {
      if (name && !known.has(name) && !computed.has(name)) bad.push(name);
    };

    const walkRefs = (v: unknown): void => {
      if (typeof v === 'string') {
        if (v.startsWith('$') && !v.startsWith('$$')) {
          addBad(v.slice(1).split('.')[0]);
        }
      } else if (Array.isArray(v)) {
        v.forEach(walkRefs);
      } else if (v && typeof v === 'object') {
        for (const val of Object.values(v as Record<string, unknown>)) walkRefs(val);
      }
    };

    for (const stage of pipeline) {
      const op      = Object.keys(stage)[0];
      const content = stage[op] as Record<string, unknown> | undefined;
      if (!op || !content) continue;

      const behavior = STAGE_BEHAVIORS[op];
      if (!behavior) {
        walkRefs(content);
      } else {
        if (behavior.validateKeys) {
          for (const k of Object.keys(content)) if (!k.startsWith('$')) addBad(k.split('.')[0]);
        }
        if (behavior.walkValues)  walkRefs(content);
        if (behavior.computeKeys) {
          for (const k of Object.keys(content)) if (!behavior.skipIdKey || k !== '_id') computed.add(k);
        }
        if (behavior.special === 'lookup') {
          if (typeof content['localField'] === 'string') addBad((content['localField'] as string).split('.')[0]);
          if (typeof content['as'] === 'string')         computed.add(content['as'] as string);
        }
      }
    }

    const unknown = [...new Set(bad)];
    if (!unknown.length) return;

    throw new Error(
      `Pipeline references field(s) not registered for "${source.name}": ` +
      `${unknown.map(f => `"${f}"`).join(', ')}. ` +
      `Registered fields: ${[...known].map(f => `"${f}"`).join(', ')}.`,
    );
  }

  private async runAggregation(collection: string, pipeline: unknown[]): Promise<Row[]> {
    const db = this.connection.db;
    if (!db) throw new Error('MongoDB connection not ready');
    const timeoutMs = Number(process.env['MONGODB_PIPELINE_TIMEOUT_MS']) || 30_000;
    return db
      .collection(collection)
      .aggregate(pipeline as Row[], { allowDiskUse: true, maxTimeMS: timeoutMs })
      .toArray() as Promise<Row[]>;
  }

  private flush(
    intent:     IntentKind,
    prompt:     string,
    plan:       TaskPlan,
    collection: string,
    rows:       Row[],
    durationMs: number,
  ): void {
    if (rows.length) {
      this.cache.setCached(intent, prompt, { plan, rows })
        .catch(err => this.logger.error(`cache write failed: ${err}`));
    }
    this.history.save({
      prompt, intent, collection,
      pipeline:  plan.pipeline ?? [],
      rows,
      rowCount:  rows.length,
      durationMs,
    }).catch(err => this.logger.error(`history save failed: ${err}`));
  }

  private resolveSource(sourceName: string | undefined) {
    return getSources().find(s => s.name === sourceName || s.collection === sourceName);
  }

  // ── Skill dispatcher ────────────────────────────────────────────────────────
  // Single place that maps plan.skills → the right skill function(s).
  // Callers handle caching and intent-specific early-exits before delegating here.

  private async dispatchSkills(
    plan:     TaskPlan,
    rows:     Row[],
    prompt:   string,
    aggUsage: TokenUsage,
    opts:     LlmOpts,
  ): Promise<ExecuteResult<DashboardSpec | ReportResult | InquiryResult>> {
    const { apiKey, model: userModel, provider: userProvider, maxTokens } = opts;
    const source = this.resolveSource(plan.query.sourceName);
    const chartMaxTokens   = clampStageTokens(maxTokens, CHART_MAX_TOKENS);
    const inquiryMaxTokens = clampStageTokens(maxTokens, INQUIRY_MAX_TOKENS);

    // Chart-only (dashboard intent, or auto-routed without a report narrative)
    if (plan.skills.includes('chart') && !plan.skills.includes('report')) {
      if (!rows.length) throw new Error('No data found. Try rephrasing your question or checking the data source.');
      const { result: chart, usage } = await runChart(
        rows, prompt, plan.strategy, plan.chartHint, source, apiKey, userModel, userProvider, chartMaxTokens,
      );
      if (chart.widgets.length) {
        this.chartRepo.save({ prompt, sourceName: source?.name ?? '', dashboard: chart }).catch(() => undefined);
      }
      return { result: chart, usage: addUsage(aggUsage, usage) };
    }

    // Report — optionally accompanied by a chart when wantChart=true
    if (plan.skills.includes('report') && rows.length) {
      const withChart = plan.skills.includes('chart') && rows.length >= 2;
      const { result: rep, usage: repUsage } = await runReportSkill({
        rows, prompt, withChart, apiKey, userModel, userProvider, maxTokens,
      });
      this.logger.log(`report done | sections: ${rep.reportSections.length}${withChart ? ' — generating chart' : ''}`);

      if (!withChart) return { result: rep, usage: addUsage(aggUsage, repUsage) };

      const fallback = { layout: 'operational' as const, title: prompt, summary: '', widgets: [] };
      const { result: chart, usage: chartUsage } = await runChart(
        rows, prompt, plan.strategy, plan.chartHint, source, apiKey, userModel, userProvider, chartMaxTokens,
      ).catch(err => {
        this.logger.warn(`chart failed (non-fatal): ${err}`);
        return { result: fallback, usage: zeroUsage() };
      });
      const merged = { ...rep, ...(chart.widgets.length ? { chart } : {}) };
      return { result: merged, usage: addUsage(aggUsage, addUsage(repUsage, chartUsage)) };
    }

    // Inquiry
    if (plan.skills.includes('inquiry') && rows.length) {
      this.logger.log(`inquiry | rows: ${rows.length}`);
      const { result, usage } = await runInquirySkill({
        rows, prompt, apiKey, userModel, userProvider, maxTokens: inquiryMaxTokens,
      });
      this.logger.log('inquiry done');
      return { result, usage: addUsage(aggUsage, usage) };
    }

    return {
      result: { summary: 'The request could not be answered from the available sources.' },
      usage:  aggUsage,
    };
  }

  // ── Feature executors ───────────────────────────────────────────────────────

  async executeDashboard(
    prompt:  string,
    context: CoreMessage[] = [],
    opts:    LlmOpts = {},
  ): Promise<ExecuteResult<DashboardSpec | InquiryResult>> {
    if (!context.length) {
      const cached = await this.cache.getCached<DashboardSpec>(DASHBOARD_FULL_INTENT, prompt);
      if (cached) {
        this.logger.log('full dashboard cache hit — skipping both LLM calls');
        return { result: cached, usage: zeroUsage() };
      }
    }

    const { plan, rows, usage: aggUsage } = await this.aggregate(prompt, 'dashboard', context, opts);

    if (!plan.skills.includes('chart')) {
      this.logger.log('dashboard → falling back to inquiry (needsData: false)');
      return this.executeInquiry(prompt, context, opts);
    }

    if (!rows.length) {
      this.logger.log('dashboard → no matching rows; returning empty dashboard state');
      return {
        result: {
          layout:  'operational',
          title:   prompt,
          summary: 'No matching records were found for this dashboard request. Try broadening the filters or rephrasing the question.',
          widgets: [],
        },
        usage: aggUsage,
      };
    }

    const dispatched = await this.dispatchSkills(plan, rows, prompt, aggUsage, opts);
    const chart = dispatched.result as DashboardSpec;
    if (chart.widgets?.length && !context.length) {
      this.cache.setCached(DASHBOARD_FULL_INTENT, prompt, chart).catch(() => undefined);
    }
    return dispatched as ExecuteResult<DashboardSpec | InquiryResult>;
  }

  async executeReport(
    prompt:  string,
    context: CoreMessage[] = [],
    opts:    LlmOpts = {},
  ): Promise<ExecuteResult<ReportResult>> {
    if (!context.length) {
      const cached = await this.cache.getCached<ReportResult>('report:full', prompt);
      if (cached) {
        this.logger.log('full report cache hit — skipping LLM calls');
        return { result: cached, usage: zeroUsage() };
      }
    }

    const { plan, rows, usage: aggUsage } = await this.aggregate(prompt, 'report', context, opts);

    if (!plan.skills.includes('report')) {
      return { result: { reportSections: [{ heading: 'No Data', body: 'The request could not be answered from the available sources.' }] }, usage: aggUsage };
    }
    if (!rows.length) {
      return { result: { reportSections: [{ heading: 'No Data', body: 'No matching records found for this request.' }] }, usage: aggUsage };
    }

    this.logger.log(`report | rows: ${rows.length}`);
    const dispatched = await this.dispatchSkills(plan, rows, prompt, aggUsage, opts);
    if (!context.length) this.cache.setCached('report:full', prompt, dispatched.result).catch(() => undefined);
    return dispatched as ExecuteResult<ReportResult>;
  }

  async executeInquiry(
    prompt:  string,
    context: CoreMessage[] = [],
    opts:    LlmOpts = {},
  ): Promise<ExecuteResult<InquiryResult>> {
    const { plan, rows, usage: aggUsage } = await this.aggregate(prompt, 'general_question', context, opts);
    return this.dispatchSkills(plan, rows, prompt, aggUsage, opts) as Promise<ExecuteResult<InquiryResult>>;
  }

  async execute(
    prompt:  string,
    context: CoreMessage[] = [],
    opts:    LlmOpts = {},
  ): Promise<ExecuteResult<DashboardSpec | ReportResult | InquiryResult>> {
    const { plan, rows, usage: aggUsage } = await this.aggregate(prompt, 'general_question', context, opts);
    return this.dispatchSkills(plan, rows, prompt, aggUsage, opts);
  }
}
