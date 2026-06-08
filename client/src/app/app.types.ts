import type { EChartsCoreOption } from 'echarts';

export type ModeKey = 'dashboard' | 'report' | 'inquiry';

export interface PromptExample {
  label: string;
  prompt: string;
  dataStoreName?: string;
  tag?: string;
}

export interface MetaMode {
  intent: ModeKey;
  placeholder?: string;
  prompts?: PromptExample[];
}

export interface MetaResponse {
  modes: MetaMode[];
  sources: Array<{
    name: string;
    collection: string;
    description: string;
    fieldCount: number;
  }>;
}

export interface AnalyticsRequest {
  prompt: string;
  intent: 'dashboard' | 'report' | 'general_question';
  dataStoreName?: string;
}

export interface ReportSection {
  heading: string;
  body: string;
}

export interface DashboardChart {
  title?: string;
  chartType?: string;
  option: EChartsCoreOption;
}

export interface DashboardResponse {
  intent: 'dashboard';
  chart: DashboardChart;
}

export interface ReportResponse {
  intent: 'report';
  reportSections?: ReportSection[];
}

export interface InquiryResponse {
  intent: 'general_question' | 'inquiry';
  summary?: string;
}

export type AnalyticsResponse = DashboardResponse | ReportResponse | InquiryResponse;

export interface Stage {
  label: string;
  detail: string;
  at: number;
}
