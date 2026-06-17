import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import type { CoreMessage } from 'ai';
import { runSupervisorPlan } from '../ai/planner';
import { runChart } from '../ai/chart';
import { runReportSkill } from '../ai/writer';
import { runInquirySkill } from '../ai/writer';
import { getSources } from '../sources/sources-cache';
import { normalizeToken } from '../sources/source.repository';
import { CacheService } from '../cache/cache.service';
import { HistoryService } from '../history/history.service';
import { ChartResultsRepository } from '../ai/chart-results.repository';
import type { IntentKind, DataSource, TaskPlan, DashboardSpec } from '../types';

export interface AggregationResult {
  plan: TaskPlan;
  rows: Record<string, unknown>[];
}

export interface ReportResult {
  reportSections: { heading: string; body: string }[];
  chart?: DashboardSpec;
}

const FORBIDDEN_STAGES = new Set(['$function', '$merge', '$out', '$where', '$eval']);
const DASHBOARD_FULL_INTENT = 'dashboard:full';

@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  constructor(
    private readonly cache: CacheService,
    private readonly history: HistoryService,
    private readonly chartRepo: ChartResultsRepository,
  ) {}

  // ── Core aggregation ────────────────────────────────────────────────────────

  async aggregate(
    prompt: string,
    intent: IntentKind,
    context: CoreMessage[] = [],
    apiKey?: string,
  ): Promise<AggregationResult> {
    const sources = getSources();
    const t0 = Date.now();

    // Cache check — skip for multi-turn context
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

    const validated = this.resolvePipeline(plan, sources);
    if (!validated) return { plan, rows: [] };

    const rows = await this.runAggregation(validated.collection, plan.pipeline!);
    const durationMs = Date.now() - t0;

    if (rows.length) {
      this.logger.log(`result | collection: ${validated.collection} | rows: ${rows.length}`);
    } else {
      this.logger.log(`result | collection: ${validated.collection} | rows: 0`);
    }

    this.flush(intent, prompt, plan, validated.collection, rows, durationMs);
    return { plan, rows };
  }

  private resolvePipeline(
    plan: TaskPlan,
    sources: DataSource[],
  ): { pipeline: Record<string, unknown>[]; collection: string } | null {
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

  private async runAggregation(
    collection: string,
    pipeline: unknown[],
  ): Promise<Record<string, unknown>[]> {
    const db = mongoose.connection.db;
    if (!db) throw new Error('MongoDB connection not ready');
    const timeoutMs = Number(process.env['MONGODB_PIPELINE_TIMEOUT_MS']) || 30_000;
    return db
      .collection(collection)
      .aggregate(pipeline as Record<string, unknown>[], { allowDiskUse: true, maxTimeMS: timeoutMs })
      .toArray() as Promise<Record<string, unknown>[]>;
  }

  private flush(
    intent: IntentKind,
    prompt: string,
    plan: TaskPlan,
    collection: string,
    rows: Record<string, unknown>[],
    durationMs: number,
  ): void {
    if (rows.length) {
      this.cache.setCached(intent, prompt, { plan, rows })
        .catch(err => this.logger.error(`cache write failed: ${err}`));
    }
    this.history.save({
      prompt, intent, collection,
      pipeline: plan.pipeline ?? [],
      rows, rowCount: rows.length, durationMs,
    }).catch(err => this.logger.error(`history save failed: ${err}`));
  }

  // ── Feature executors ───────────────────────────────────────────────────────

  async executeDashboard(
    prompt: string,
    context: CoreMessage[] = [],
    apiKey?: string,
  ): Promise<DashboardSpec> {
    // Full dashboard cache (both LLM calls)
    if (!context.length) {
      const cached = await this.cache.getCached<DashboardSpec>(DASHBOARD_FULL_INTENT, prompt);
      if (cached) {
        this.logger.log('full dashboard cache hit — skipping both LLM calls');
        return cached;
      }
    }

    const { plan, rows } = await this.aggregate(prompt, 'dashboard', context, apiKey);

    if (!plan.skills.includes('chart')) {
      throw new Error('Planner did not produce a chart execution path for this request.');
    }
    if (!rows.length) {
      throw new Error('No data found. Try rephrasing your question or checking the data source.');
    }

    const source = getSources().find(
      s => s.name === plan.query.sourceName || s.collection === plan.query.sourceName,
    );

    const chart = await runChart(rows, prompt, plan.strategy, plan.chartHint, source, apiKey)
      .catch((): DashboardSpec => ({
        layout: 'analytical', title: prompt,
        summary: 'Chart could not be generated.', widgets: [],
      }));

    if (chart.widgets.length) {
      // Persist to chart_results (fire-and-forget)
      this.chartRepo.save({ prompt, sourceName: source?.name ?? '', dashboard: chart })
        .catch(() => undefined);

      // Cache the full dashboard (only for single-turn)
      if (!context.length) {
        this.cache.setCached(DASHBOARD_FULL_INTENT, prompt, chart)
          .catch(() => undefined);
      }
    }

    return chart;
  }

  async executeReport(
    prompt: string,
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
      const source = getSources().find(
        s => s.name === plan.query.sourceName || s.collection === plan.query.sourceName,
      );
      const [reportResult, chartResult] = await Promise.all([
        runReportSkill({ rows, prompt, withChart: true, apiKey })
          .catch(() => ({ reportSections: [{ heading: 'Error', body: 'Could not generate report sections.' }] })),
        runChart(rows, prompt, plan.strategy, plan.chartHint, source, apiKey)
          .catch(() => ({ layout: 'analytical' as const, title: prompt, summary: '', widgets: [] })),
      ]);
      this.logger.log(`report done (with chart) | sections: ${reportResult.reportSections.length}`);
      return { ...reportResult, ...(chartResult.widgets.length ? { chart: chartResult } : {}) };
    }

    const result = await runReportSkill({ rows, prompt, apiKey })
      .catch(() => ({ reportSections: [{ heading: 'Error', body: 'Could not generate report sections.' }] }));
    this.logger.log(`report done | sections: ${result.reportSections.length}`);
    return result;
  }

  async executeInquiry(
    prompt: string,
    context: CoreMessage[] = [],
    apiKey?: string,
  ): Promise<{ summary: string }> {
    const { plan, rows } = await this.aggregate(prompt, 'general_question', context, apiKey);

    if (!plan.skills.includes('inquiry')) {
      return { summary: 'The request could not be answered from the available sources.' };
    }
    if (!rows.length) {
      return { summary: 'No matching data found for this question.' };
    }

    this.logger.log(`inquiry | rows: ${rows.length}`);
    const result = await runInquirySkill({ rows, prompt, apiKey })
      .catch(() => ({ summary: 'Could not summarize results. Please try again.' }));
    this.logger.log('inquiry done');
    return result;
  }
}
