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
import type {
  IntentKind,
  DataSource,
  TaskPlan,
  DashboardSpec,
  ReportSection,
} from '../types';
import { clampStageTokens, hasStringMatch, normalizePipelineStage, patchConvert, ResolvedPipeline, Row } from './pipeline.transform';
import { assertNoForbiddenStages, validatePipelineFields } from './pipeline.validation';
import { buildPlannerOutputHint, buildPlanValidationHint, buildRetryHint, buildEmptyResultHint } from './retry-hints';



// Re-exported so existing consumers importing from this module keep working.
export { patchConvert };

/** Options forwarded to every LLM stage (planner, chart, writer). */
export interface LlmOpts {
  apiKey?: string;
  model?: string;
  provider?: string;
  maxTokens?: number;
  /** Caller identity, attached to persisted results_history entries. */
  userId?: string;
}

export interface AggregationResult {
  plan: TaskPlan;
  rows: Row[];
  usage: TokenUsage;
}

export interface ReportResult {
  reportSections: ReportSection[];
  chart?: DashboardSpec;
}

export interface InquiryResult {
  summary: string;
}

export interface ExecuteResult<T> {
  result: T;
  usage: TokenUsage;
}

// Per-stage output ceilings, overridable via environment. Read once at boot.
const PLANNER_MAX_TOKENS = Number(process.env['PLANNER_MAX_TOKENS'] ?? 600);
const CHART_MAX_TOKENS = Number(process.env['CHART_MAX_TOKENS'] ?? 2_000);
const INQUIRY_MAX_TOKENS = Number(process.env['INQUIRY_MAX_TOKENS'] ?? 400);

/** Cache key namespace for a fully rendered dashboard (plan + rows + chart). */
const DASHBOARD_FULL_INTENT = 'dashboard:full';
/** Cache key namespace for a fully rendered report. */
const REPORT_FULL_INTENT = 'report:full';

/** One planning attempt plus one hint-guided retry. */
const MAX_PLAN_ATTEMPTS = 2;

const DEFAULT_PIPELINE_TIMEOUT_MS = 30_000;

/**
 * Orchestrates the prompt → plan → MongoDB aggregation → rendering flow.
 *
 * Lifecycle of a request:
 *   1. `aggregate()` — cache lookup, then a plan/execute loop with one
 *      hint-guided retry (`runWithRetry`). Pipelines are normalized,
 *      checked against forbidden stages, and field-validated against the
 *      registered source schema before touching MongoDB.
 *   2. `dispatchSkills()` — routes the resulting rows to the chart, report,
 *      or inquiry renderer depending on the plan's declared skills.
 *   3. The `execute*` entry points wrap 1+2 with per-intent caching and
 *      empty-state fallbacks.
 *
 * Caching rule: results are only read/written when there is no conversation
 * context, since context changes what the same prompt means.
 */
@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  constructor(
    @InjectConnection()
    private readonly connection: Connection,
    private readonly cache: CacheService,
    private readonly history: HistoryService,
    private readonly chartRepo: ChartResultsRepository,
  ) {}

  /**
   * Plans and runs a MongoDB aggregation for the given prompt.
   * Serves from cache when possible; otherwise persists the outcome
   * (fire-and-forget) to cache and history.
   */
  async aggregate(
    prompt: string,
    intent: IntentKind,
    context: CoreMessage[] = [],
    opts: LlmOpts = {},
  ): Promise<AggregationResult> {
    const sources = getSources();
    const startedAt = Date.now();

    if (!context.length) {
      const cached = await this.cache.getCached<AggregationResult>(
        intent,
        prompt,
      );
      if (cached) {
        this.logger.log(
          `cache hit | intent: ${intent} | rows: ${cached.rows.length}`,
        );
        return { ...cached, usage: cached.usage ?? zeroUsage() };
      }
    }

    const { plan, rows, collection, usage } = await this.runWithRetry(
      prompt,
      intent,
      sources,
      context,
      opts,
    );
    const durationMs = Date.now() - startedAt;
    this.logger.log(
      `result | collection: ${collection ?? '—'} | rows: ${rows.length} | ${durationMs}ms`,
    );

    if (collection)
      this.flush(
        intent,
        prompt,
        plan,
        collection,
        rows,
        durationMs,
        usage,
        context.length > 0,
        opts.userId,
      );
    return { plan, rows, usage };
  }

  /**
   * The plan → validate → execute loop. Each failure class on the first
   * attempt is converted into a corrective hint (see ./pipeline/retry-hints)
   * and fed back to the planner exactly once; a second failure propagates.
   *
   * Failure classes handled:
   *  - planner output schema violations
   *  - pipeline structure / unknown-field validation errors
   *  - recognized MongoDB execution errors (date coercion, projection mix, …)
   *  - zero rows from a string-valued $match (likely enum casing mismatch)
   */
  private async runWithRetry(
    prompt: string,
    intent: IntentKind,
    sources: DataSource[],
    context: CoreMessage[],
    opts: LlmOpts,
  ): Promise<{
    plan: TaskPlan;
    rows: Row[];
    collection?: string;
    usage: TokenUsage;
  }> {
    const {
      apiKey,
      model: userModel,
      provider: userProvider,
      maxTokens,
    } = opts;
    let hint: string | undefined;
    let plannerUsage: TokenUsage = zeroUsage();
    const plannerMaxTokens = clampStageTokens(maxTokens, PLANNER_MAX_TOKENS);

    for (let attempt = 0; attempt < MAX_PLAN_ATTEMPTS; attempt++) {
      const isFirstAttempt = attempt === 0;

      // 1. Ask the planner for a task plan (optionally with a retry hint).
      let plan: TaskPlan;
      let usage: TokenUsage;
      try {
        ({ plan, usage } = await runSupervisorPlan({
          prompt,
          intent,
          sources,
          context,
          apiKey,
          userModel,
          userProvider,
          hint,
          maxTokens: plannerMaxTokens,
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isFirstAttempt) {
          hint = buildPlannerOutputHint(msg);
          continue;
        }
        throw err;
      }
      plannerUsage = addUsage(plannerUsage, usage);
      this.logger.log(
        `plan [${attempt + 1}] | skills: [${plan.skills.join(', ')}] | needsData: ${plan.needsData} | source: ${plan.query.sourceName ?? '—'} | stages: ${plan.pipeline?.length ?? 0}`,
      );

      // 2. Normalize + validate the pipeline against the registered schema.
      let resolved: ResolvedPipeline | null;
      try {
        resolved = this.resolvePipeline(plan, sources);
        if (resolved) plan.pipeline = resolved.pipeline;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isFirstAttempt) {
          hint = buildPlanValidationHint(msg);
          continue;
        }
        throw err;
      }

      // No pipeline to run (e.g. the plan needs no data): return early.
      if (!resolved) return { plan, rows: [], usage: plannerUsage };

      // 3. Execute against MongoDB.
      let rows: Row[];
      try {
        rows = await this.runAggregation(
          resolved.collection,
          patchConvert(resolved.pipeline) as Row[],
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isFirstAttempt) {
          hint = buildRetryHint(msg, msg.toLowerCase(), resolved, sources, (log) =>
            this.logger.warn(log),
          );
          if (hint) continue;
        }
        throw err;
      }

      // 4. Empty result on a string $match usually means bad enum casing —
      //    worth exactly one replanning attempt.
      if (
        rows.length === 0 &&
        plan.needsData &&
        isFirstAttempt &&
        hasStringMatch(resolved.pipeline)
      ) {
        hint = buildEmptyResultHint(resolved.pipeline);
        continue;
      }

      return {
        plan,
        rows,
        collection: resolved.collection,
        usage: plannerUsage,
      };
    }

    throw new Error(
      'Pipeline failed after 2 attempts — check your data source schema and field values.',
    );
  }

  /**
   * Binds the plan's pipeline to a registered data source and runs all
   * safety checks (stage normalization, forbidden stages, field validation).
   *
   * @returns `null` when the plan has no aggregation work to do.
   * @throws  When the named source is unregistered or validation fails.
   */
  private resolvePipeline(
    plan: TaskPlan,
    sources: DataSource[],
  ): ResolvedPipeline | null {
    if (!plan.skills.includes('aggregation') || !plan.pipeline?.length) {
      this.logger.log(
        'skipping pipeline — no aggregation skill or empty pipeline',
      );
      return null;
    }

    const token = normalizeToken(plan.query.sourceName ?? '');
    const source = sources.find(
      (s) =>
        normalizeToken(s.name) === token ||
        normalizeToken(s.collection) === token,
    );
    if (!source?.collection) {
      const hint = plan.query.sourceName
        ? ` matching "${plan.query.sourceName}"`
        : '';
      throw new Error(
        `No registered data source${hint}. Only registered sources may be queried.`,
      );
    }
    const collection = source.collection;

    const normalizedPipeline = plan.pipeline.map((stage, index) => {
      const normalized = normalizePipelineStage(stage, index);
      if (normalized.strippedKeys.length) {
        this.logger.warn(
          `pipeline stage ${index + 1}: stripped non-operator keys [${normalized.strippedKeys.join(', ')}]`,
        );
      }
      return normalized.stage;
    });

    assertNoForbiddenStages(normalizedPipeline);

    if (source?.fields?.length) {
      validatePipelineFields(normalizedPipeline, source);
    }

    return { pipeline: normalizedPipeline, collection };
  }

  /** Runs a validated pipeline with disk spill enabled and a hard timeout. */
  private async runAggregation(
    collection: string,
    pipeline: unknown[],
  ): Promise<Row[]> {
    const db = this.connection.db;
    if (!db) throw new Error('MongoDB connection not ready');
    const timeoutMs =
      Number(process.env['MONGODB_PIPELINE_TIMEOUT_MS']) ||
      DEFAULT_PIPELINE_TIMEOUT_MS;
    return db
      .collection(collection)
      .aggregate(pipeline as Row[], {
        allowDiskUse: true,
        maxTimeMS: timeoutMs,
      })
      .toArray();
  }

  /**
   * Fire-and-forget persistence after a successful aggregation:
   * cache (only for context-free prompts with results) and history (always).
   * Failures are logged, never surfaced to the caller.
   */
  private flush(
    intent: IntentKind,
    prompt: string,
    plan: TaskPlan,
    collection: string,
    rows: Row[],
    durationMs: number,
    usage: TokenUsage,
    hasContext: boolean,
    userId: string | undefined,
  ): void {
    if (rows.length && !hasContext) {
      this.cache
        .setCached(intent, prompt, { plan, rows, usage })
        .catch((err) => this.logger.error(`cache write failed: ${err}`));
    }
    if (!userId) {
      this.logger.warn('history save skipped — no userId on this request');
      return;
    }
    this.history
      .save({
        userId,
        prompt,
        intent,
        collection,
        pipeline: plan.pipeline ?? [],
        rows,
        rowCount: rows.length,
        durationMs,
      })
      .then((id) => {
        this.logger.log(
          `history saved | id: ${id} | collection: ${collection} | pipeline stages: ${plan.pipeline?.length ?? 0} | rows: ${rows.length}`,
        );
        const preview = rows.slice(0, 10);
        this.logger.log(
          `history data${rows.length > preview.length ? ` (first ${preview.length}/${rows.length})` : ''}: ${JSON.stringify(preview)}`,
        );
      })
      .catch((err) => this.logger.error(`history save failed: ${err}`));
  }

  private resolveSource(sourceName: string | undefined) {
    return getSources().find(
      (s) => s.name === sourceName || s.collection === sourceName,
    );
  }

  /**
   * Routes aggregation output to the renderer(s) declared in the plan:
   *
   *  - chart only            → dashboard spec (persisted for reuse)
   *  - report (± chart)      → report sections, chart attached best-effort
   *  - inquiry               → short textual summary
   *  - none of the above     → generic "could not answer" summary
   */
  private async dispatchSkills(
    plan: TaskPlan,
    rows: Row[],
    prompt: string,
    aggUsage: TokenUsage,
    opts: LlmOpts,
  ): Promise<ExecuteResult<DashboardSpec | ReportResult | InquiryResult>> {
    const {
      apiKey,
      model: userModel,
      provider: userProvider,
      maxTokens,
    } = opts;
    const source = this.resolveSource(plan.query.sourceName);
    const chartMaxTokens = clampStageTokens(maxTokens, CHART_MAX_TOKENS);
    const inquiryMaxTokens = clampStageTokens(maxTokens, INQUIRY_MAX_TOKENS);

    if (plan.skills.includes('chart') && !plan.skills.includes('report')) {
      if (!rows.length)
        throw new Error(
          'No data found. Try rephrasing your question or checking the data source.',
        );
      const { result: chart, usage } = await runChart(
        rows,
        prompt,
        plan.strategy,
        plan.chartHint,
        source,
        apiKey,
        userModel,
        userProvider,
        chartMaxTokens,
      );
      if (chart.widgets.length) {
        this.chartRepo
          .save({ prompt, sourceName: source?.name ?? '', dashboard: chart })
          .catch(() => undefined);
      }
      return { result: chart, usage: addUsage(aggUsage, usage) };
    }

    if (plan.skills.includes('report') && rows.length) {
      // A chart needs at least two data points to be meaningful.
      const withChart = plan.skills.includes('chart') && rows.length >= 2;
      const { result: rep, usage: repUsage } = await runReportSkill({
        rows,
        prompt,
        withChart,
        apiKey,
        userModel,
        userProvider,
        maxTokens,
      });
      this.logger.log(
        `report done | sections: ${rep.reportSections.length}${withChart ? ' — generating chart' : ''}`,
      );

      if (!withChart)
        return { result: rep, usage: addUsage(aggUsage, repUsage) };

      // Chart generation is best-effort: a failure degrades to report-only.
      const fallback = {
        layout: 'operational' as const,
        title: prompt,
        summary: '',
        widgets: [],
      };
      const { result: chart, usage: chartUsage } = await runChart(
        rows,
        prompt,
        plan.strategy,
        plan.chartHint,
        source,
        apiKey,
        userModel,
        userProvider,
        chartMaxTokens,
      ).catch((err) => {
        this.logger.warn(`chart failed (non-fatal): ${err}`);
        return { result: fallback, usage: zeroUsage() };
      });
      const merged = { ...rep, ...(chart.widgets.length ? { chart } : {}) };
      return {
        result: merged,
        usage: addUsage(aggUsage, addUsage(repUsage, chartUsage)),
      };
    }

    if (plan.skills.includes('inquiry') && rows.length) {
      this.logger.log(`inquiry | rows: ${rows.length}`);
      const { result, usage } = await runInquirySkill({
        rows,
        prompt,
        apiKey,
        userModel,
        userProvider,
        maxTokens: inquiryMaxTokens,
      });
      this.logger.log('inquiry done');
      return { result, usage: addUsage(aggUsage, usage) };
    }

    return {
      result: {
        summary:
          'The request could not be answered from the available sources.',
      },
      usage: aggUsage,
    };
  }

  /**
   * Prompt → dashboard. Falls back to an inquiry when the plan produced no
   * chart skill, and returns an explanatory empty dashboard when the
   * aggregation matched no rows.
   */
  async executeDashboard(
    prompt: string,
    context: CoreMessage[] = [],
    opts: LlmOpts = {},
  ): Promise<ExecuteResult<DashboardSpec | InquiryResult>> {
    if (!context.length) {
      const cached = await this.cache.getCached<DashboardSpec>(
        DASHBOARD_FULL_INTENT,
        prompt,
      );
      if (cached) {
        this.logger.log('full dashboard cache hit — skipping both LLM calls');
        return { result: cached, usage: zeroUsage() };
      }
    }

    const {
      plan,
      rows,
      usage: aggUsage,
    } = await this.aggregate(prompt, 'dashboard', context, opts);

    if (!plan.skills.includes('chart')) {
      this.logger.log('dashboard → falling back to inquiry (needsData: false)');
      return this.executeInquiry(prompt, context, opts);
    }

    if (!rows.length) {
      this.logger.log(
        'dashboard → no matching rows; returning empty dashboard state',
      );
      return {
        result: {
          layout: 'operational',
          title: prompt,
          summary:
            'No matching records were found for this dashboard request. Try broadening the filters or rephrasing the question.',
          widgets: [],
        },
        usage: aggUsage,
      };
    }

    const dispatched = await this.dispatchSkills(
      plan,
      rows,
      prompt,
      aggUsage,
      opts,
    );
    const chart = dispatched.result as DashboardSpec;
    if (chart.widgets?.length && !context.length) {
      this.cache
        .setCached(DASHBOARD_FULL_INTENT, prompt, chart)
        .catch(() => undefined);
    }
    return dispatched as ExecuteResult<DashboardSpec | InquiryResult>;
  }

  /**
   * Prompt → written report (optionally with an embedded chart). Returns a
   * "No Data" section when the plan lacks the report skill or nothing matched.
   */
  async executeReport(
    prompt: string,
    context: CoreMessage[] = [],
    opts: LlmOpts = {},
  ): Promise<ExecuteResult<ReportResult>> {
    if (!context.length) {
      const cached = await this.cache.getCached<ReportResult>(
        REPORT_FULL_INTENT,
        prompt,
      );
      if (cached) {
        this.logger.log('full report cache hit — skipping LLM calls');
        return { result: cached, usage: zeroUsage() };
      }
    }

    const {
      plan,
      rows,
      usage: aggUsage,
    } = await this.aggregate(prompt, 'report', context, opts);

    if (!plan.skills.includes('report')) {
      return {
        result: {
          reportSections: [
            {
              heading: 'No Data',
              body: 'The request could not be answered from the available sources.',
            },
          ],
        },
        usage: aggUsage,
      };
    }
    if (!rows.length) {
      return {
        result: {
          reportSections: [
            {
              heading: 'No Data',
              body: 'No matching records found for this request.',
            },
          ],
        },
        usage: aggUsage,
      };
    }

    this.logger.log(`report | rows: ${rows.length}`);
    const dispatched = await this.dispatchSkills(
      plan,
      rows,
      prompt,
      aggUsage,
      opts,
    );
    if (!context.length)
      this.cache
        .setCached(REPORT_FULL_INTENT, prompt, dispatched.result)
        .catch(() => undefined);
    return dispatched as ExecuteResult<ReportResult>;
  }

  /** Prompt → short textual answer. */
  async executeInquiry(
    prompt: string,
    context: CoreMessage[] = [],
    opts: LlmOpts = {},
  ): Promise<ExecuteResult<InquiryResult>> {
    const {
      plan,
      rows,
      usage: aggUsage,
    } = await this.aggregate(prompt, 'general_question', context, opts);
    return this.dispatchSkills(plan, rows, prompt, aggUsage, opts) as Promise<
      ExecuteResult<InquiryResult>
    >;
  }

  /** Generic entry point: lets the plan decide which renderer applies. */
  async execute(
    prompt: string,
    context: CoreMessage[] = [],
    opts: LlmOpts = {},
  ): Promise<ExecuteResult<DashboardSpec | ReportResult | InquiryResult>> {
    const {
      plan,
      rows,
      usage: aggUsage,
    } = await this.aggregate(prompt, 'general_question', context, opts);
    return this.dispatchSkills(plan, rows, prompt, aggUsage, opts);
  }
}