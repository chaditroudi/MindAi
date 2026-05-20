import { mastra } from '../mastra/index.js';
import { capabilityMatrix, reviewModes } from '../config/review-catalog.js';
import type {
  DashboardResponse,
  InquiryResponse,
  PromptRequest,
  ReportResponse,
  ReviewMetaResponse,
} from '../http/contracts.js';

type WorkflowId = 'generalQuestionWorkflow' | 'reportWorkflow' | 'dashboardWorkflow';

class AnalyticsService {
  async runInquiry(input: PromptRequest): Promise<InquiryResponse> {
    const t0 = Date.now();
    const result = await this.runWorkflow('generalQuestionWorkflow', {
      prompt: input.prompt,
      scope: input.scope,
      topic: input.topic,
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
      blueprintId: input.blueprintId,
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
      blueprintId: input.blueprintId,
      intent: 'dashboard',
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

  getReviewMeta(): ReviewMetaResponse {
    return {
      app: {
        title: 'منصة مايند للتحليلات البلدية',
        subtitle: 'خلفية Express وتشغيل Mastra وتنفيذ بيانات MongoDB وواجهة مراجعة ECharts.',
        stack: ['Express', 'Mastra', 'MongoDB', 'ECharts', 'OpenRouter'],
      },
      modes: reviewModes,
      capabilities: capabilityMatrix,
    };
  }

  private async runWorkflow(workflowId: WorkflowId, inputData: Record<string, unknown>) {
    const run = await mastra.getWorkflow(workflowId).createRunAsync();
    const result = await run.start({ inputData });

    if (result.status !== 'success') {
      throw new Error(`فشل سير العمل ${workflowId} بالحالة "${result.status}"`);
    }

    return result.result;
  }
}

export const analyticsService = new AnalyticsService();
