import { mastra } from '../mastra/index.js';
import { z } from 'zod';
import {
  capabilityMatrix,
  reviewModeShells,
  type ReviewEndpoint,
  type ReviewModeDefinition,
  type ReviewPromptDefinition,
} from '../config/review-catalog.js';
import { dataStoreRepo } from '../db/datastore.repository.js';
import type { DataStore } from '../types/index.js';
import type {
  DashboardResponse,
  InquiryResponse,
  PromptRequest,
  ReportResponse,
  ReviewMetaResponse,
} from '../http/contracts.js';
import { envTimeout, withTimeout } from '../mastra/runtime/timeout.js';
import {
  buildConversationMemoryPrompt,
  resolveConversationRef,
  saveConversationExchange,
} from './conversation-memory.js';

type WorkflowId = 'generalQuestionWorkflow' | 'reportWorkflow' | 'dashboardWorkflow';

const generatedReviewModesSchema = z.object({
  modes: z.array(
    z.object({
      endpoint: z.enum(['/api/dashboard', '/api/report', '/api/inquiry']),
      placeholder: z.string(),
      prompts: z.array(
        z.object({
          label: z.string(),
          prompt: z.string(),
          dataStoreName: z.string().optional(),
          topic: z.string().optional(),
        }),
      ),
    }),
  ),
});

class AnalyticsService {
  async runInquiry(input: PromptRequest): Promise<InquiryResponse> {
    const t0 = Date.now();
    const conversation = resolveConversationRef(input);
    const planningPrompt = await this.withConversationMemory(input, 'general_question', conversation);
    const result = await this.runWorkflow('generalQuestionWorkflow', {
      prompt: input.prompt,
      planningPrompt,
      scope: input.scope,
      topic: input.topic,
      dataStoreName: input.dataStoreName,
    });
    await saveConversationExchange({
      ref: conversation,
      scope: input.scope,
      intent: 'general_question',
      userPrompt: input.prompt,
      assistantContent: result.summary,
    });
    return {
      intent: 'general_question',
      summary: result.summary,
      recordLinks: result.recordLinks,
      conversation,
      audit: {
        plan: result.plan,
        enrichment: result.enrichment,
        elapsedMs: Date.now() - t0,
      },
    };
  }

  async runReport(input: PromptRequest): Promise<ReportResponse> {
    const t0 = Date.now();
    const conversation = resolveConversationRef(input);
    const planningPrompt = await this.withConversationMemory(input, 'report', conversation);
    const result = await this.runWorkflow('reportWorkflow', {
      prompt: input.prompt,
      planningPrompt,
      scope: input.scope,
      topic: input.topic,
      dataStoreName: input.dataStoreName,
    });
    await saveConversationExchange({
      ref: conversation,
      scope: input.scope,
      intent: 'report',
      userPrompt: input.prompt,
      assistantContent: renderReportMemory(result.reportSections),
    });
    return {
      intent: 'report',
      reportSections: result.reportSections,
      charts: result.charts,
      conversation,
      audit: {
        plan: result.plan,
        dataset: result.dataset,
        elapsedMs: Date.now() - t0,
      },
    };
  }

  async runDashboard(input: PromptRequest): Promise<DashboardResponse> {
    const t0 = Date.now();
    const conversation = resolveConversationRef(input);
    const planningPrompt = await this.withConversationMemory(input, 'dashboard', conversation);
    const result = await this.runWorkflow('dashboardWorkflow', {
      prompt: input.prompt,
      planningPrompt,
      scope: input.scope,
      topic: input.topic,
      dataStoreName: input.dataStoreName,
      intent: 'dashboard',
      theme: input.theme ?? 'light',
    });
    await saveConversationExchange({
      ref: conversation,
      scope: input.scope,
      intent: 'dashboard',
      userPrompt: input.prompt,
      assistantContent: renderDashboardMemory(result),
    });
    return {
      intent: 'dashboard',
      chart: result.chart,
      conversation,
      audit: {
        plan: result.plan,
        pipeline: result.executedPipeline,
        schema: result.dataset.schema,
        jsonSchema: result.dataset.jsonSchema,
        enrichment: result.enrichment,
        elapsedMs: Date.now() - t0,
      },
    };
  }

  async getReviewMeta(): Promise<ReviewMetaResponse> {
    return {
      app: {
        title: 'منصة مايند للتحليلات البلدية',
        subtitle: 'خلفية Express وتشغيل Mastra وتنفيذ بيانات MongoDB وواجهة مراجعة ECharts.',
        stack: ['Express', 'Mastra', 'MongoDB', 'ECharts', 'Ollama'],
      },
      modes: await this.generateReviewModes(),
      capabilities: capabilityMatrix,
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
    const memory = await buildConversationMemoryPrompt(conversation);
    if (!memory) return input.prompt;

    return [
      memory,
      '',
      `Current ${intent} request:`,
      input.prompt,
    ].join('\n');
  }

  private async generateReviewModes(): Promise<ReviewModeDefinition[]> {
    const dataStores = await dataStoreRepo.listAccessibleDataStores();
    const deterministicModes = buildDeterministicReviewModes(dataStores);
    const agent = mastra.getAgent('writerAgent');

    try {
      const result = await withTimeout(
        agent.generate(
          [
            {
              role: 'user',
              content: JSON.stringify({
                instruction:
                  'Polish these metadata-generated Arabic UI prompt suggestions. Keep every prompt grounded in the provided dataStoreName and real fields. Return only JSON. Do not invent new data stores, fields, filters, or values.',
                platform: { dataStores },
                seedModes: deterministicModes,
                outputRules: {
                  perEndpoint: {
                    '/api/inquiry': 'record search prompts; result should be summary with record links',
                    '/api/report': 'analytical report prompts; result should be narrative sections, charts optional',
                    '/api/dashboard': 'single-chart prompts; result should be one chart',
                  },
                  language: 'Arabic labels, practical English prompts',
                  promptsPerEndpoint: 6,
                  preserveDataStoreNames: true,
                },
              }),
            },
          ],
          { output: generatedReviewModesSchema, maxTokens: 2200, temperature: 0.2 },
        ),
        'meta.prompt-suggestions',
        envTimeout('META_GENERATION_TIMEOUT_MS', 5000),
      );

      return mergeModeSuggestions(result.object.modes, deterministicModes, dataStores);
    } catch {
      return deterministicModes;
    }
  }
}

export const analyticsService = new AnalyticsService();

function renderReportMemory(reportSections: Array<{ heading: string; body: string }>) {
  return reportSections.map((section) => `${section.heading}: ${section.body}`).join(' ');
}

function renderDashboardMemory(result: {
  chart?: { accessibility?: { description?: string } };
  plan?: { query?: { dataStoreName?: string; dimensions?: string[] } };
}) {
  const query = result.plan?.query;
  const title = query?.dataStoreName
    ? `Dashboard generated for ${query.dataStoreName}${query.dimensions?.length ? ` by ${query.dimensions.join(', ')}` : ''}`
    : 'Dashboard chart generated';
  const description = result.chart?.accessibility?.description;
  return description ? `${title}. ${description}` : title;
}

function mergeModeSuggestions(
  generated: z.infer<typeof generatedReviewModesSchema>['modes'],
  deterministic: ReviewModeDefinition[],
  dataStores: DataStore[],
): ReviewModeDefinition[] {
  return reviewModeShells.map((shell) => {
    const mode = generated.find((candidate) => candidate.endpoint === shell.endpoint);
    const fallback = deterministic.find((candidate) => candidate.endpoint === shell.endpoint);
    const generatedPrompts = normalizePrompts(mode?.prompts, dataStores);
    const prompts = generatedPrompts.length > 0 ? generatedPrompts : fallback?.prompts ?? [];
    return {
      ...shell,
      placeholder: mode?.placeholder?.trim() || fallback?.placeholder || shell.placeholder,
      prompts,
    };
  });
}

function normalizePrompts(
  prompts: z.infer<typeof generatedReviewModesSchema>['modes'][number]['prompts'] | undefined,
  dataStores: DataStore[],
) {
  const allowedDataStores = new Set(dataStores.map((dataStore) => dataStore.name));
  return (prompts ?? [])
    .filter(
      (prompt) =>
        prompt.label.trim() &&
        prompt.prompt.trim() &&
        (!prompt.dataStoreName || allowedDataStores.has(prompt.dataStoreName)),
    )
    .slice(0, 6)
    .map((prompt) => ({
      label: prompt.label.trim(),
      prompt: prompt.prompt.trim(),
      dataStoreName: prompt.dataStoreName?.trim() || undefined,
      topic: prompt.topic?.trim() || undefined,
    }));
}

function buildDeterministicReviewModes(dataStores: DataStore[]): ReviewModeDefinition[] {
  return reviewModeShells.map((shell) => ({
    ...shell,
    placeholder: placeholderForEndpoint(shell.endpoint, dataStores),
    prompts: buildPromptsForEndpoint(shell.endpoint, dataStores).slice(0, 6),
  }));
}

function placeholderForEndpoint(endpoint: ReviewEndpoint, dataStores: DataStore[]) {
  const first = dataStores[0];
  const dimension = first ? pickDimension(first)?.name : undefined;
  if (endpoint === '/api/dashboard' && first && dimension) {
    return `مثال: عدد ${humanDataStore(first)} حسب ${humanField(dimension)}`;
  }
  if (endpoint === '/api/report' && first) {
    return `مثال: تحليل ${humanDataStore(first)} حسب أهم المؤشرات`;
  }
  if (endpoint === '/api/inquiry' && first) {
    return `مثال: اعرض أحدث سجلات ${humanDataStore(first)}`;
  }
  return reviewModeShells.find((mode) => mode.endpoint === endpoint)?.placeholder ?? 'اكتب سؤالك';
}

function buildPromptsForEndpoint(endpoint: ReviewEndpoint, dataStores: DataStore[]) {
  const prompts: ReviewPromptDefinition[] = [];
  for (const dataStore of dataStores) {
    if (endpoint === '/api/dashboard') prompts.push(...dashboardPrompts(dataStore));
    if (endpoint === '/api/report') prompts.push(...reportPrompts(dataStore));
    if (endpoint === '/api/inquiry') prompts.push(...inquiryPrompts(dataStore));
  }
  return dedupePrompts(prompts);
}

function dashboardPrompts(dataStore: DataStore): ReviewPromptDefinition[] {
  const dimension = pickDimension(dataStore);
  const measure = pickMeasure(dataStore);
  const temporal = pickTemporal(dataStore);
  const enumField = pickEnumDimension(dataStore);
  const prompts: ReviewPromptDefinition[] = [];

  if (dimension) {
    prompts.push({
      label: `عدد ${humanDataStore(dataStore)} حسب ${humanField(dimension.name)}`,
      prompt: `${humanDataStore(dataStore)} count by ${dimension.name}`,
      dataStoreName: dataStore.name,
    });
    prompts.push({
      label: `أعلى 5 حسب ${humanField(dimension.name)}`,
      prompt: `top 5 ${dimension.name} by ${humanDataStore(dataStore)} count`,
      dataStoreName: dataStore.name,
    });
  }
  if (temporal) {
    prompts.push({
      label: `اتجاه ${humanDataStore(dataStore)} آخر 30 يوما`,
      prompt: `daily ${humanDataStore(dataStore)} count over the last 30 days`,
      dataStoreName: dataStore.name,
    });
  }
  if (measure && dimension) {
    prompts.push({
      label: `متوسط ${humanField(measure.name)} حسب ${humanField(dimension.name)}`,
      prompt: `average ${measure.name} by ${dimension.name}`,
      dataStoreName: dataStore.name,
    });
  }
  if (enumField && dimension) {
    prompts.push({
      label: `${humanField(enumField.name)} حسب ${humanField(dimension.name)}`,
      prompt: `${humanDataStore(dataStore)} count by ${dimension.name} and ${enumField.name}`,
      dataStoreName: dataStore.name,
    });
  }
  return prompts;
}

function reportPrompts(dataStore: DataStore): ReviewPromptDefinition[] {
  const dimension = pickDimension(dataStore);
  const measure = pickMeasure(dataStore);
  const temporal = pickTemporal(dataStore);
  const enumField = pickEnumDimension(dataStore);
  const prompts: ReviewPromptDefinition[] = [];

  if (dimension) {
    prompts.push({
      label: `تحليل ${humanDataStore(dataStore)} حسب ${humanField(dimension.name)}`,
      prompt: `analyze ${humanDataStore(dataStore)} count by ${dimension.name}`,
      dataStoreName: dataStore.name,
    });
  }
  if (temporal && dimension) {
    prompts.push({
      label: `اتجاهات ${humanDataStore(dataStore)} آخر 90 يوما`,
      prompt: `analyze ${humanDataStore(dataStore)} volume by ${dimension.name} over the last 90 days`,
      dataStoreName: dataStore.name,
    });
  }
  if (measure && dimension) {
    prompts.push({
      label: `تقرير ${humanField(measure.name)} حسب ${humanField(dimension.name)}`,
      prompt: `analyze average ${measure.name} by ${dimension.name}`,
      dataStoreName: dataStore.name,
    });
  }
  if (enumField) {
    prompts.push({
      label: `مقارنة حسب ${humanField(enumField.name)}`,
      prompt: `compare ${humanDataStore(dataStore)} by ${enumField.name}`,
      dataStoreName: dataStore.name,
    });
  }
  return prompts;
}

function inquiryPrompts(dataStore: DataStore): ReviewPromptDefinition[] {
  const temporal = pickTemporal(dataStore);
  const enumField = pickEnumDimension(dataStore);
  const dimension = pickDimension(dataStore);
  const prompts: ReviewPromptDefinition[] = [
    {
      label: `أحدث سجلات ${humanDataStore(dataStore)}`,
      prompt: `find recent ${humanDataStore(dataStore)}`,
      dataStoreName: dataStore.name,
    },
  ];

  if (enumField?.enumValues?.[0]) {
    prompts.push({
      label: `${humanField(enumField.name)} = ${enumField.enumValues[0]}`,
      prompt: `find ${humanDataStore(dataStore)} where ${enumField.name} is ${enumField.enumValues[0]}`,
      dataStoreName: dataStore.name,
    });
  }
  if (temporal) {
    prompts.push({
      label: `آخر 7 أيام من ${humanDataStore(dataStore)}`,
      prompt: `show ${humanDataStore(dataStore)} from the last 7 days`,
      dataStoreName: dataStore.name,
    });
  }
  if (dimension) {
    prompts.push({
      label: `بحث حسب ${humanField(dimension.name)}`,
      prompt: `find ${humanDataStore(dataStore)} by ${dimension.name}`,
      dataStoreName: dataStore.name,
    });
  }
  return prompts;
}

function pickDimension(dataStore: DataStore) {
  return (
    dataStore.fields.find((field) => ['municipality', 'serviceType', 'permitType', 'projectType'].includes(field.name)) ??
    dataStore.fields.find((field) => field.role === 'dimension' && field.type !== 'enum')
  );
}

function pickEnumDimension(dataStore: DataStore) {
  return dataStore.fields.find((field) => field.role === 'dimension' && field.enumValues?.length);
}

function pickMeasure(dataStore: DataStore) {
  return dataStore.fields.find((field) => field.role === 'measure');
}

function pickTemporal(dataStore: DataStore) {
  return dataStore.fields.find((field) => field.role === 'temporal' || field.type === 'date' || field.type === 'datetime');
}

function humanDataStore(dataStore: DataStore) {
  return splitIdentifier(dataStore.name).toLowerCase();
}

function humanField(fieldName: string) {
  return splitIdentifier(fieldName).toLowerCase();
}

function splitIdentifier(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
}

function dedupePrompts(prompts: ReviewPromptDefinition[]) {
  const seen = new Set<string>();
  return prompts.filter((prompt) => {
    const key = `${prompt.dataStoreName}:${prompt.prompt.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
