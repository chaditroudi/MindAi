import { mastra } from '../mastra/index.js';
import {
  agentCapabilityCards,
  capabilityMatrix,
  reviewModeShells,
  type ReviewEndpoint,
  type ReviewModeDefinition,
  type ReviewPromptDefinition,
} from '../config/review-catalog.js';
import { dataStoreRepo } from '../db/datastore.repository.js';
import { historyRepo } from '../db/results-history.repository.js';
import type { DataStore } from '../types/index.js';
import type {
  DashboardResponse,
  InquiryResponse,
  PromptRequest,
  ReportResponse,
  SearchResponse,
  ReviewMetaResponse,
} from '../http/contracts.js';
import { log } from '../observability/log.js';
import { envTimeout, withTimeout } from '../utils/timeout.js';
import {
  buildConversationMemoryPrompt,
  resolveConversationRef,
  saveConversationExchange,
} from './conversation-memory.js';
import { PRINCIPAL_SUPERVISOR_DATASTORES } from '../config/principal-supervisor-structure.js';
import { resolveDatasetContext, saveDatasetContext } from './dataset-context.js';
import { resolveSchemaContext } from './schema-context.js';

type WorkflowId = 'generalQuestionWorkflow' | 'reportWorkflow' | 'dashboardWorkflow' | 'searchWorkflow';

class AnalyticsService {
  async runInquiry(input: PromptRequest): Promise<InquiryResponse> {
    const t0 = Date.now();
    const conversation = resolveConversationRef(input);
    const datastores = this.resolveRequestDataStores(input, conversation);
    const dataset = resolveDatasetContext(conversation, input.dataset);
    const planningPrompt = await this.withConversationMemory(input, 'general_question', conversation);
    const result = await this.runWorkflow('generalQuestionWorkflow', {
      prompt: input.prompt,
      planningPrompt,
      scope: input.scope,
      topic: input.topic,
      dataStoreName: input.dataStoreName,
      datastores,
      dataset,
    });
    saveDatasetContext(conversation, dataset ?? result.dataset);
    this.persistConversation({
      ref: conversation,
      scope: input.scope,
      intent: 'general_question',
      userPrompt: input.prompt,
      assistantContent: result.summary,
    });
    const durationMs = Date.now() - t0;
    historyRepo.save({
      tenantId: input.scope.tenantId,
      userId: input.scope.userId,
      intent: 'general_question',
      prompt: input.prompt,
      datastores,
      pipeline: result.plan?.pipeline,
      result: { summary: result.summary, recordLinks: result.recordLinks, rows: result.dataset?.rows },
      durationMs,
    }).catch((err) => log.warn('history.save.failed', { intent: 'general_question', err: err instanceof Error ? err.message : String(err) }));
    return {
      intent: 'general_question',
      summary: result.summary,
      recordLinks: result.recordLinks,
      conversation,
      audit: { plan: result.plan, dataset: result.dataset, elapsedMs: durationMs },
    };
  }

  async runReport(input: PromptRequest): Promise<ReportResponse> {
    const t0 = Date.now();
    const conversation = resolveConversationRef(input);
    const datastores = this.resolveRequestDataStores(input, conversation);
    const dataset = resolveDatasetContext(conversation, input.dataset);
    const planningPrompt = await this.withConversationMemory(input, 'report', conversation);
    const result = await this.runWorkflow('reportWorkflow', {
      prompt: input.prompt,
      planningPrompt,
      scope: input.scope,
      topic: input.topic,
      dataStoreName: input.dataStoreName,
      datastores,
      dataset,
    });
    saveDatasetContext(conversation, dataset ?? result.dataset);
    this.persistConversation({
      ref: conversation,
      scope: input.scope,
      intent: 'report',
      userPrompt: input.prompt,
      assistantContent: result.reportSections.map((s: { heading: string; body: string }) => `${s.heading}: ${s.body}`).join(' '),
    });
    const durationMs = Date.now() - t0;
    historyRepo.save({
      tenantId: input.scope.tenantId,
      userId: input.scope.userId,
      intent: 'report',
      prompt: input.prompt,
      datastores,
      pipeline: result.plan?.pipeline,
      result: { reportSections: result.reportSections, chart: result.charts?.[0], rows: result.dataset?.rows },
      durationMs,
    }).catch((err) => log.warn('history.save.failed', { intent: 'report', err: err instanceof Error ? err.message : String(err) }));
    return {
      intent: 'report',
      reportSections: result.reportSections,
      charts: result.charts,
      conversation,
      audit: { plan: result.plan, dataset: result.dataset, elapsedMs: durationMs },
    };
  }

  async runSearch(input: PromptRequest): Promise<SearchResponse> {
    const t0 = Date.now();
    const conversation = resolveConversationRef(input);
    const datastores = this.resolveRequestDataStores(input, conversation);
    const result = await this.runWorkflow('searchWorkflow', {
      prompt: input.prompt,
      scope: input.scope,
      dataStoreName: input.dataStoreName,
      datastores,
    });
    this.persistConversation({
      ref: conversation,
      scope: input.scope,
      intent: 'general_question',
      userPrompt: input.prompt,
      assistantContent: result.summary,
    });
    const durationMs = Date.now() - t0;
    historyRepo.save({
      tenantId: input.scope.tenantId,
      userId: input.scope.userId,
      intent: 'search',
      prompt: input.prompt,
      datastores,
      pipeline: result.searchPlan.pipeline,
      result: { summary: result.summary, searchTerms: result.searchPlan.searchTerms, recordLinks: result.recordLinks },
      durationMs,
    }).catch((err) => log.warn('history.save.failed', { intent: 'search', err: err instanceof Error ? err.message : String(err) }));
    return {
      intent: 'search',
      summary: result.summary,
      searchTerms: result.searchPlan.searchTerms,
      recordLinks: result.recordLinks,
      conversation,
      audit: {
        collection: result.searchPlan.collection,
        elapsedMs: durationMs,
      },
    };
  }

  async runDashboard(input: PromptRequest): Promise<DashboardResponse> {
    const t0 = Date.now();
    const conversation = resolveConversationRef(input);
    const dataset = resolveDatasetContext(conversation, input.dataset);
    const planningPrompt = await this.withConversationMemory(input, 'dashboard', conversation);
    const datastores = this.resolveRequestDataStores(input, conversation)
      ?? (dataset ? [deriveDataStoreFromDataset(dataset.schema, input.dataStoreName)] : undefined);
    if (!datastores?.length) {
      throw new Error('schemaStructure or datastores must be provided once so future dashboard prompts can align with the saved structure.');
    }
    const result = await this.runWorkflow('dashboardWorkflow', {
      prompt: input.prompt,
      planningPrompt,
      scope: input.scope,
      topic: input.topic,
      dataStoreName: input.dataStoreName,
      intent: 'dashboard',
      theme: input.theme ?? 'light',
      datastores,
      ...(dataset ? { dataset } : {}),
    });
    saveDatasetContext(conversation, dataset ?? result.dataset);
    const query = result.plan?.query;
    const title = query?.dataStoreName
      ? `Dashboard for ${query.dataStoreName}${query.dimensions?.length ? ` by ${(query.dimensions as string[]).join(', ')}` : ''}`
      : 'Dashboard';
    this.persistConversation({
      ref: conversation,
      scope: input.scope,
      intent: 'dashboard',
      userPrompt: input.prompt,
      assistantContent: result.chart?.accessibility?.description ?? title,
    });
    const durationMs = Date.now() - t0;
    historyRepo.save({
      tenantId: input.scope.tenantId,
      userId: input.scope.userId,
      intent: 'dashboard',
      prompt: input.prompt,
      datastores,
      pipeline: result.executedPipeline,
      result: { chart: result.chart, rows: result.dataset?.rows },
      durationMs,
    }).catch((err) => log.warn('history.save.failed', { intent: 'dashboard', err: err instanceof Error ? err.message : String(err) }));
    return {
      intent: 'dashboard',
      chart: result.chart,
      conversation,
      audit: {
        plan: result.plan,
        pipeline: result.executedPipeline,
        dataset: result.dataset,
        schema: result.dataset.schema,
        elapsedMs: durationMs,
      },
    };
  }

  async getReviewMeta(): Promise<ReviewMetaResponse> {
    const dataStores = await dataStoreRepo.listAccessibleDataStores()
      .catch(() => PRINCIPAL_SUPERVISOR_DATASTORES);
    return {
      app: {
        title: 'منصة مايند للتحليلات البلدية',
        subtitle: 'خلفية Express وتشغيل Mastra وتنفيذ بيانات MongoDB وواجهة مراجعة ECharts.',
        stack: ['Express', 'Mastra', 'MongoDB', 'ECharts', 'OpenRouter/Groq'],
      },
      modes: buildReviewModes(dataStores),
      capabilities: capabilityMatrix,
      agents: agentCapabilityCards,
    };
  }

  private async runWorkflow(workflowId: WorkflowId, inputData: Record<string, unknown>) {
    const run = await mastra.getWorkflow(workflowId).createRunAsync();
    const result = await withTimeout(
      run.start({ inputData }),
      `workflow.${workflowId}`,
      envTimeout('WORKFLOW_TIMEOUT_MS', 30000),
    );
    if (result.status !== 'success') {
      throw new Error(`فشل سير العمل ${workflowId} بالحالة "${result.status}"`);
    }
    return result.result;
  }

  private async withConversationMemory(
    input: PromptRequest,
    intent: 'general_question' | 'report' | 'dashboard',
    conversation: { threadId: string; resourceId: string },
  ) {
    if (!isFollowUpPrompt(input.prompt)) return input.prompt;
    try {
      const memory = await buildConversationMemoryPrompt(conversation);
      if (!memory) return input.prompt;
      return [memory, '', `Current ${intent} request:`, input.prompt].join('\n');
    } catch {
      return input.prompt;
    }
  }

  private persistConversation(input: Parameters<typeof saveConversationExchange>[0]) {
    void saveConversationExchange(input).catch((error) => {
      log.warn('conversation.save.failed', {
        tenantId: input.scope.tenantId,
        threadId: input.ref.threadId,
        err: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private resolveRequestDataStores(
    input: PromptRequest,
    conversation: { threadId: string; resourceId: string },
  ) {
    return resolveSchemaContext({
      ref: conversation,
      datastores: input.datastores,
      schemaStructure: input.schemaStructure,
      prompt: input.prompt,
    });
  }
}

export const analyticsService = new AnalyticsService();

// ─── Review Mode Generation (deterministic) ───────────────────────────────────

function buildReviewModes(dataStores: DataStore[]): ReviewModeDefinition[] {
  return reviewModeShells.map((shell) => ({
    ...shell,
    placeholder: buildPlaceholder(shell.endpoint, dataStores),
    prompts: buildPrompts(shell.endpoint, dataStores).slice(0, 6),
  }));
}

function buildPlaceholder(endpoint: ReviewEndpoint, dataStores: DataStore[]) {
  const first = dataStores[0];
  const dim = first ? pickDimension(first)?.name : undefined;
  if (endpoint === '/api/dashboard' && first && dim) return `مثال: عدد ${human(first.name)} حسب ${human(dim)}`;
  if (endpoint === '/api/report' && first) return `مثال: تحليل ${human(first.name)} حسب أهم المؤشرات`;
  if (endpoint === '/api/inquiry' && first) return `مثال: اعرض أحدث سجلات ${human(first.name)}`;
  return reviewModeShells.find((m) => m.endpoint === endpoint)?.placeholder ?? 'اكتب سؤالك';
}

function buildPrompts(endpoint: ReviewEndpoint, dataStores: DataStore[]) {
  const out: ReviewPromptDefinition[] = [];
  for (const ds of dataStores) {
    if (endpoint === '/api/dashboard') out.push(...dashboardPrompts(ds));
    if (endpoint === '/api/report') out.push(...reportPrompts(ds));
    if (endpoint === '/api/inquiry') out.push(...inquiryPrompts(ds));
  }
  const seen = new Set<string>();
  return out.filter((p) => {
    const key = `${p.dataStoreName}:${p.prompt.toLowerCase()}`;
    return seen.has(key) ? false : (seen.add(key), true);
  });
}

function dashboardPrompts(ds: DataStore): ReviewPromptDefinition[] {
  const dim = pickDimension(ds);
  const measure = pickMeasure(ds);
  const temporal = pickTemporal(ds);
  const enumDim = pickEnumDimension(ds);
  const out: ReviewPromptDefinition[] = [];
  if (dim) {
    out.push({ label: `عدد ${human(ds.name)} حسب ${human(dim.name)}`, prompt: `${human(ds.name)} count by ${dim.name}`, dataStoreName: ds.name });
    out.push({ label: `أعلى 5 حسب ${human(dim.name)}`, prompt: `top 5 ${dim.name} by ${human(ds.name)} count`, dataStoreName: ds.name });
  }
  if (temporal) out.push({ label: `اتجاه ${human(ds.name)} آخر 30 يوما`, prompt: `daily ${human(ds.name)} count over the last 30 days`, dataStoreName: ds.name });
  if (measure && dim) out.push({ label: `متوسط ${human(measure.name)} حسب ${human(dim.name)}`, prompt: `average ${measure.name} by ${dim.name}`, dataStoreName: ds.name });
  if (enumDim && dim) out.push({ label: `${human(enumDim.name)} حسب ${human(dim.name)}`, prompt: `${human(ds.name)} count by ${dim.name} and ${enumDim.name}`, dataStoreName: ds.name });
  return out;
}

function reportPrompts(ds: DataStore): ReviewPromptDefinition[] {
  const dim = pickDimension(ds);
  const measure = pickMeasure(ds);
  const temporal = pickTemporal(ds);
  const enumDim = pickEnumDimension(ds);
  const out: ReviewPromptDefinition[] = [];
  if (dim) out.push({ label: `تحليل ${human(ds.name)} حسب ${human(dim.name)}`, prompt: `analyze ${human(ds.name)} count by ${dim.name}`, dataStoreName: ds.name });
  if (temporal && dim) out.push({ label: `اتجاهات ${human(ds.name)} آخر 90 يوما`, prompt: `analyze ${human(ds.name)} volume by ${dim.name} over the last 90 days`, dataStoreName: ds.name });
  if (measure && dim) out.push({ label: `تقرير ${human(measure.name)} حسب ${human(dim.name)}`, prompt: `analyze average ${measure.name} by ${dim.name}`, dataStoreName: ds.name });
  if (enumDim) out.push({ label: `مقارنة حسب ${human(enumDim.name)}`, prompt: `compare ${human(ds.name)} by ${enumDim.name}`, dataStoreName: ds.name });
  return out;
}

function inquiryPrompts(ds: DataStore): ReviewPromptDefinition[] {
  const temporal = pickTemporal(ds);
  const enumDim = pickEnumDimension(ds);
  const dim = pickDimension(ds);
  const out: ReviewPromptDefinition[] = [
    { label: `أحدث سجلات ${human(ds.name)}`, prompt: `find recent ${human(ds.name)}`, dataStoreName: ds.name },
  ];
  if (enumDim?.enumValues?.[0]) out.push({ label: `${human(enumDim.name)} = ${enumDim.enumValues[0]}`, prompt: `find ${human(ds.name)} where ${enumDim.name} is ${enumDim.enumValues[0]}`, dataStoreName: ds.name });
  if (temporal) out.push({ label: `آخر 7 أيام من ${human(ds.name)}`, prompt: `show ${human(ds.name)} from the last 7 days`, dataStoreName: ds.name });
  if (dim) out.push({ label: `بحث حسب ${human(dim.name)}`, prompt: `find ${human(ds.name)} by ${dim.name}`, dataStoreName: ds.name });
  return out;
}

function pickDimension(ds: DataStore) {
  return ds.fields.find((f) => ['municipality', 'serviceType', 'permitType', 'projectType'].includes(f.name))
    ?? ds.fields.find((f) => f.role === 'dimension' && f.type !== 'enum');
}
function pickEnumDimension(ds: DataStore) { return ds.fields.find((f) => f.role === 'dimension' && f.enumValues?.length); }
function pickMeasure(ds: DataStore) { return ds.fields.find((f) => f.role === 'measure'); }
function pickTemporal(ds: DataStore) { return ds.fields.find((f) => f.role === 'temporal' || f.type === 'date' || f.type === 'datetime'); }

function human(name: string) {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
}

function deriveDataStoreFromDataset(schema: Record<string, string>, dataStoreName?: string): DataStore {
  return {
    name: dataStoreName?.trim() || 'RequestDataset',
    collection: dataStoreName?.trim() || 'request_dataset',
    description: 'Derived from request dataset schema for prompt-first in-memory execution.',
    fields: Object.entries(schema).map(([name, type]) => ({
      name,
      type: coerceFieldType(type),
      role: inferFieldRole(name, type),
    })),
  };
}

function coerceFieldType(type: string): DataStore['fields'][number]['type'] {
  if (type === 'integer') return 'integer';
  if (type === 'number') return 'number';
  if (type === 'boolean') return 'boolean';
  if (type === 'date') return 'date';
  if (type === 'datetime') return 'datetime';
  if (type === 'geo') return 'geo';
  return 'string';
}

function inferFieldRole(name: string, type: string): DataStore['fields'][number]['role'] | undefined {
  if (type === 'number' || type === 'integer') {
    return /^(value|count|total|sum|avg|average|amount|score|rate|quantity)$/i.test(name)
      ? 'measure'
      : undefined;
  }
  if (type === 'date' || type === 'datetime') return 'temporal';
  if (/id$/i.test(name)) return 'id';
  return 'dimension';
}

function isFollowUpPrompt(prompt: string) {
  return [
    /\b(same|again|also|too|previous|above|that|those|it|them|compare it|what about)\b/i,
    /\b(use|keep|with)\s+(the\s+)?same\b/i,
    /(نفس|أيضا|ايضا|كذلك|السابق|السابقة|أعلاه|اعلاه|هذا|هذه|ذلك|تلك|قارنها|ماذا عن)/i,
  ].some((p) => p.test(prompt));
}
