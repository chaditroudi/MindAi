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

function isProviderRateLimitError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  const code = (err as { statusCode?: number; status?: number }).statusCode
    ?? (err as { status?: number }).status;

  if (code === 429) return true;

  return (
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('tokens per day') ||
    msg.includes('tpm') ||
    msg.includes('rpm') ||
    msg.includes('service tier') ||
    msg.includes('quota')
  );
}

function numericFields(rows: Record<string, unknown>[]): string[] {
  const keys = Object.keys(rows[0] ?? {});
  return keys.filter(key =>
    rows.slice(0, 20).some(row => row[key] != null) &&
    rows.slice(0, 20).every(row => row[key] == null || typeof row[key] === 'number'),
  );
}

function categoricalFields(rows: Record<string, unknown>[], nums: string[]): string[] {
  return Object.keys(rows[0] ?? {}).filter(key => !nums.includes(key));
}

function formatNumber(value: number): string {
  return Number.isInteger(value)
    ? value.toLocaleString()
    : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function summarizeTopCategories(rows: Record<string, unknown>[], field: string, limit = 3): string {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const label = row[field] == null ? '' : String(row[field]).trim();
    if (!label) continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  if (!top.length) return '';

  return top
    .map(([label, count]) => `${label} (${formatNumber(count)})`)
    .join(', ');
}

function buildFallbackInquiry(rows: Record<string, unknown>[]): { summary: string } {
  const nums = numericFields(rows);
  const cats = categoricalFields(rows, nums);
  const parts: string[] = [`${formatNumber(rows.length)} record(s) matched the request.`];

  if (cats.length) {
    const top = summarizeTopCategories(rows, cats[0]);
    if (top) parts.push(`Top ${cats[0]} values: ${top}.`);
  }

  if (nums.length) {
    const field = nums[0];
    const total = rows.reduce((sum, row) => sum + (typeof row[field] === 'number' ? row[field] : 0), 0);
    parts.push(`Total ${field}: ${formatNumber(total)}.`);
  }

  parts.push('This concise answer was generated without the AI writer because the provider is temporarily rate-limited.');
  return { summary: parts.join(' ') };
}

function buildFallbackReport(rows: Record<string, unknown>[]): ReportResult {
  const nums = numericFields(rows);
  const cats = categoricalFields(rows, nums);

  const overview = `${formatNumber(rows.length)} record(s) matched the request. This fallback report was generated because the AI writer is temporarily rate-limited.`;

  const findings: string[] = [];
  if (cats.length) {
    const top = summarizeTopCategories(rows, cats[0]);
    if (top) findings.push(`Top ${cats[0]} values are ${top}.`);
  }
  if (nums.length) {
    const field = nums[0];
    const total = rows.reduce((sum, row) => sum + (typeof row[field] === 'number' ? row[field] : 0), 0);
    const average = total / rows.length;
    findings.push(`Across all returned rows, total ${field} is ${formatNumber(total)} and the average is ${formatNumber(average)}.`);
  }
  if (nums.length > 1) {
    const field = nums[1];
    const max = Math.max(...rows.map(row => typeof row[field] === 'number' ? row[field] : Number.NEGATIVE_INFINITY));
    if (Number.isFinite(max)) findings.push(`The highest observed ${field} is ${formatNumber(max)}.`);
  }

  const breakdown = cats.length
    ? `The returned dataset can be grouped most clearly by ${cats[0]}. ${summarizeTopCategories(rows, cats[0], 5) || 'No non-empty category values were found.'}`
    : `The returned dataset is primarily numeric, with fields such as ${nums.slice(0, 4).join(', ') || 'none detected'}.`;

  return {
    reportSections: [
      { heading: 'Overview', body: overview },
      { heading: 'Key Findings', body: findings.join(' ') || 'No stable categorical or numeric patterns could be derived from the returned rows.' },
      { heading: 'Breakdown', body: breakdown },
    ],
  };
}

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
    const db = this.connection.db;
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
  ): Promise<DashboardSpec | { summary: string }> {
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
      // Conversational or memory-based question — answer it as text instead of a chart
      this.logger.log('dashboard → falling back to inquiry (needsData: false)');
      return this.executeInquiry(prompt, context, apiKey);
    }
    if (!rows.length) {
      throw new Error('No data found. Try rephrasing your question or checking the data source.');
    }

    const source = getSources().find(
      s => s.name === plan.query.sourceName || s.collection === plan.query.sourceName,
    );

    let chart: DashboardSpec;
    try {
      chart = await runChart(rows, prompt, plan.strategy, plan.chartHint, source, apiKey);
    } catch (err) {
      if (isProviderRateLimitError(err)) {
        this.logger.warn('chart AI rate-limited — falling back to deterministic inquiry summary');
        return buildFallbackInquiry(rows);
      }
      throw err;
    }

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
          .catch(err => {
            if (isProviderRateLimitError(err)) {
              this.logger.warn('writer AI rate-limited — returning deterministic fallback report');
              return buildFallbackReport(rows);
            }
            throw err;
          }),
        runChart(rows, prompt, plan.strategy, plan.chartHint, source, apiKey)
          .catch(err => {
            if (isProviderRateLimitError(err)) {
              this.logger.warn('chart AI rate-limited during report generation — omitting chart');
              return { layout: 'analytical' as const, title: prompt, summary: '', widgets: [] };
            }
            throw err;
          }),
      ]);
      this.logger.log(`report done (with chart) | sections: ${reportResult.reportSections.length}`);
      return { ...reportResult, ...(chartResult.widgets.length ? { chart: chartResult } : {}) };
    }

    const result = await runReportSkill({ rows, prompt, apiKey })
      .catch(err => {
        if (isProviderRateLimitError(err)) {
          this.logger.warn('writer AI rate-limited — returning deterministic fallback report');
          return buildFallbackReport(rows);
        }
        throw err;
      });
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
      .catch(err => {
        if (isProviderRateLimitError(err)) {
          this.logger.warn('writer AI rate-limited — returning deterministic fallback inquiry');
          return buildFallbackInquiry(rows);
        }
        throw err;
      });
    this.logger.log('inquiry done');
    return result;
  }
}
