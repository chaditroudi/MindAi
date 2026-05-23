import { mastra } from '../mastra/index.js';
import { z } from 'zod';
import { capabilityMatrix, reviewModeShells, type ReviewModeDefinition } from '../config/review-catalog.js';
import { dataStoreRepo } from '../db/datastore.repository.js';
import type {
  DashboardResponse,
  InquiryResponse,
  PromptRequest,
  ReportResponse,
  ReviewMetaResponse,
} from '../http/contracts.js';
import { envTimeout, withTimeout } from '../mastra/runtime/timeout.js';

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
    const result = await this.runWorkflow('generalQuestionWorkflow', {
      prompt: input.prompt,
      scope: input.scope,
      topic: input.topic,
      dataStoreName: input.dataStoreName,
    });
    return {
      intent: 'general_question',
      summary: result.summary,
      recordLinks: result.recordLinks,
      audit: {
        plan: result.plan,
        elapsedMs: Date.now() - t0,
      },
    };
  }

  async runReport(input: PromptRequest): Promise<ReportResponse> {
    const t0 = Date.now();
    const result = await this.runWorkflow('reportWorkflow', {
      prompt: input.prompt,
      scope: input.scope,
      topic: input.topic,
      dataStoreName: input.dataStoreName,
    });
    return {
      intent: 'report',
      reportSections: result.reportSections,
      charts: result.charts,
      audit: {
        plan: result.plan,
        elapsedMs: Date.now() - t0,
      },
    };
  }

  async runDashboard(input: PromptRequest): Promise<DashboardResponse> {
    const t0 = Date.now();
    const result = await this.runWorkflow('dashboardWorkflow', {
      prompt: input.prompt,
      scope: input.scope,
      topic: input.topic,
      dataStoreName: input.dataStoreName,
      intent: 'dashboard',
      theme: input.theme ?? 'light',
    });
    return {
      intent: 'dashboard',
      chart: result.chart,
      audit: {
        plan: result.plan,
        pipeline: result.executedPipeline,
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

  private async generateReviewModes(): Promise<ReviewModeDefinition[]> {
    const dataStores = await dataStoreRepo.listAccessibleDataStores();
    const agent = mastra.getAgent('writerAgent');
    const result = await withTimeout(
      agent.generate(
        [
          {
            role: 'user',
            content: JSON.stringify({
              instruction:
                'Generate Arabic UI prompt suggestions from the platform data stores and fields. Return only JSON. Do not use static demo examples. Make prompts practical and grounded in the available field names.',
              platform: { dataStores },
              modes: reviewModeShells.map(({ endpoint, label, description }) => ({ endpoint, label, description })),
              outputRules: {
                perEndpoint: {
                  '/api/inquiry': 'general question/search prompts; result should be summary with record links',
                  '/api/report': 'report section request prompts; result should be detailed info, charts optional',
                  '/api/dashboard': 'dashboard prompts; result should be one chart',
                },
                language: 'Arabic',
                promptsPerEndpoint: 4,
              },
            }),
          },
        ],
        { output: generatedReviewModesSchema, maxTokens: 1800, temperature: 0.4 },
      ),
      'meta.prompt-suggestions',
      envTimeout('META_GENERATION_TIMEOUT_MS', 5000),
    );

    return mergeModeSuggestions(result.object.modes);
  }
}

export const analyticsService = new AnalyticsService();

function mergeModeSuggestions(
  generated: z.infer<typeof generatedReviewModesSchema>['modes'],
): ReviewModeDefinition[] {
  return reviewModeShells.map((shell) => {
    const mode = generated.find((candidate) => candidate.endpoint === shell.endpoint);
    return {
      ...shell,
      placeholder: mode?.placeholder?.trim() || shell.placeholder,
      prompts: normalizePrompts(mode?.prompts),
    };
  });
}

function normalizePrompts(
  prompts: z.infer<typeof generatedReviewModesSchema>['modes'][number]['prompts'] | undefined,
) {
  return (prompts ?? [])
    .filter((prompt) => prompt.label.trim() && prompt.prompt.trim())
    .slice(0, 6)
    .map((prompt) => ({
      label: prompt.label.trim(),
      prompt: prompt.prompt.trim(),
      dataStoreName: prompt.dataStoreName?.trim() || undefined,
      topic: prompt.topic?.trim() || undefined,
    }));
}
