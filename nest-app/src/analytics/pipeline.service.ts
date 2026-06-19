import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import type { CoreMessage } from 'ai';
import { runSupervisorPlan } from '../ai/planner';
import { runChart } from '../ai/chart';
import { runReportSkill, runInquirySkill } from '../ai/writer';
import { getSources } from '../sources/sources-cache';
import { normalizeToken } from '../sources/source.repository';
import { CacheService } from '../cache/cache.service';
import { HistoryService } from '../history/history.service';
import { ChartResultsRepository } from '../ai/chart-results.repository';
import type { IntentKind, DataSource, TaskPlan, DashboardSpec } from '../types';

// ── Shared types ──────────────────────────────────────────────────────────────

type Row              = Record<string, unknown>;
type ResolvedPipeline = { pipeline: Row[]; collection: string };

export interface ReportSection {
  heading: string;
  body:    string;
}

export interface AggregationResult {
  plan: TaskPlan;
  rows: Row[];
}

export interface ReportResult {
  reportSections: ReportSection[];
  chart?:         DashboardSpec;
}

export interface InquiryResult {
  summary: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const FORBIDDEN_STAGES     = new Set(['$function', '$merge', '$out', '$where', '$eval']);
const DASHBOARD_FULL_INTENT = 'dashboard:full';

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
    apiKey?: string,
  ): Promise<AggregationResult> {
    const sources = getSources();
    const dateNow      = Date.now();

    if (!context.length) {
      const cached = await this.cache.getCached<AggregationResult>(intent, prompt);
      if (cached) {
        this.logger.log(`cache hit | intent: ${intent} | rows: ${cached.rows.length}`);
        return cached;
      }
    }

    const plan = await runSupervisorPlan({ prompt, intent, sources, context, apiKey });
    this.logger.log(
      `plan | skills: [${plan.skills.join(', ')}] | needsData: ${plan.needsData} | source: ${plan.query.sourceName ?? '—'} | stages: ${plan.pipeline?.length ?? 0}`,
    );

    const resolved = this.resolvePipeline(plan, sources);
    if (!resolved) return { plan, rows: [] };

    const rows       = await this.runAggregation(resolved.collection, plan.pipeline!);
    const durationMs = Date.now() - dateNow;
    this.logger.log(`result | collection: ${resolved.collection} | rows: ${rows.length}`);

    this.flush(intent, prompt, plan, resolved.collection, rows, durationMs);
    return { plan, rows };
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
    if (!source?.collection && !plan.query.sourceName) {
      throw new Error('Cannot resolve collection: no source name and no matching data source');
    }
    const collection = source?.collection ?? plan.query.sourceName!;

    for (const stage of plan.pipeline) {
      const op = Object.keys(stage)[0];
      if (op && FORBIDDEN_STAGES.has(op)) {
        throw new Error(`Pipeline stage "${op}" is not permitted`);
      }
    }

    return { pipeline: plan.pipeline, collection };
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

  // ── Feature executors ───────────────────────────────────────────────────────

  async executeDashboard(
    prompt:  string,
    context: CoreMessage[] = [],
    apiKey?: string,
  ): Promise<DashboardSpec | InquiryResult> {
    if (!context.length) {
      const cached = await this.cache.getCached<DashboardSpec>(DASHBOARD_FULL_INTENT, prompt);
      if (cached) {
        this.logger.log('full dashboard cache hit — skipping both LLM calls');
        return cached;
      }
    }

    const { plan, rows } = await this.aggregate(prompt, 'dashboard', context, apiKey);

    if (!plan.skills.includes('chart')) {
      this.logger.log('dashboard → falling back to inquiry (needsData: false)');
      return this.executeInquiry(prompt, context, apiKey);
    }
    if (!rows.length) {
      throw new Error('No data found. Try rephrasing your question or checking the data source.');
    }

    const source = this.resolveSource(plan.query.sourceName);
    const chart  = await runChart(rows, prompt, plan.strategy, plan.chartHint, source, apiKey);

    if (chart.widgets.length) {
      this.chartRepo.save({ prompt, sourceName: source?.name ?? '', dashboard: chart })
        .catch(() => undefined);
      if (!context.length) {
        this.cache.setCached(DASHBOARD_FULL_INTENT, prompt, chart).catch(() => undefined);
      }
    }

    return chart;
  }

  async executeReport(
    prompt:  string,
    context: CoreMessage[] = [],
    apiKey?: string,
  ): Promise<ReportResult> {
    const { plan, rows } = await this.aggregate(prompt, 'report', context, apiKey);

    if (!plan.skills.includes('report')) {
      return { reportSections: [{ heading: 'No Data', body: 'The request could not be answered from the available sources.' }] };
    }
    if (!rows.length) {
      return { reportSections: [{ heading: 'No Data', body: 'No matching records found for this request.' }] };
    }

    this.logger.log(`report | rows: ${rows.length}`);

    if (plan.skills.includes('chart') && rows.length >= 2) {
      const source = this.resolveSource(plan.query.sourceName);
      const [reportResult, chartResult] = await Promise.all([
        runReportSkill({ rows, prompt, withChart: true, apiKey }),
        runChart(rows, prompt, plan.strategy, plan.chartHint, source, apiKey),
      ]);
      this.logger.log(`report done (with chart) | sections: ${reportResult.reportSections.length}`);
      return { ...reportResult, ...(chartResult.widgets.length ? { chart: chartResult } : {}) };
    }

    const result = await runReportSkill({ rows, prompt, apiKey });
    this.logger.log(`report done | sections: ${result.reportSections.length}`);
    return result;
  }

  async executeInquiry(
    prompt:  string,
    context: CoreMessage[] = [],
    apiKey?: string,
  ): Promise<InquiryResult> {
    const { plan, rows } = await this.aggregate(prompt, 'general_question', context, apiKey);

    if (!plan.skills.includes('inquiry')) {
      return { summary: 'The request could not be answered from the available sources.' };
    }
    if (!rows.length) {
      return { summary: 'No matching data found for this question.' };
    }

    this.logger.log(`inquiry | rows: ${rows.length}`);
    const result = await runInquirySkill({ rows, prompt, apiKey });
    this.logger.log('inquiry done');
    return result;
  }
}
