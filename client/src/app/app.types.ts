import type { EChartsCoreOption } from 'echarts';

export type ModeKey = 'dashboard' | 'report' | 'inquiry';

export interface PromptExample {
  label: string;
  prompt: string;
  tag?: string;
}

export interface MetaMode {
  intent: ModeKey;
  placeholder?: string;
  prompts?: PromptExample[];
}

export interface MetaResponse {
  modes: MetaMode[];
}

export interface AnalyticsRequest {
  prompt:    string;
  intent:    'dashboard' | 'report' | 'general_question';
  sessionId: string | null;
}

export interface ReportSection {
  heading: string;
  body:    string;
}

export type WidgetType = string;

export interface WidgetSpec {
  id:       string;
  type:     WidgetType;
  title:    string;
  insight?: string;
  option?:  EChartsCoreOption;
  columns?: string[];
  rows?:    Record<string, unknown>[];
  value?:   number;
}

export interface DashboardSpec {
  layout:   'executive' | 'analytical' | 'operational';
  title:    string;
  summary:  string;
  widgets:  WidgetSpec[];
}

// ─── Stored result per assistant message ─────────────────────────────────────

export interface MessageResult {
  type:             'dashboard' | 'report' | 'inquiry' | 'report+chart';
  dashboardSpec?:   DashboardSpec;
  reportSections?:  ReportSection[];
  summary?:         string;
  durationMs:       number;
}

// ─── Conversation messages ────────────────────────────────────────────────────

export interface ConversationMessage {
  messageId:  string;
  role:       'user' | 'assistant';
  prompt?:    string;
  intent?:    ModeKey;
  result?:    MessageResult;
  createdAt?: string;
}

// ─── Saved results ────────────────────────────────────────────────────────────

export interface SavedResultSummary {
  id:        string;
  title:     string;
  prompt:    string;
  intent:    ModeKey;
  createdAt: string;
}

export interface SavedResultDetail extends SavedResultSummary {
  result: MessageResult;
}

// ─── Session ──────────────────────────────────────────────────────────────────

export interface SessionSummary {
  sessionId:    string;
  title:        string;
  intent:       string;
  createdAt:    string;
  updatedAt:    string;
  messageCount: number;
}

export interface SessionDetail {
  session:  SessionSummary;
  messages: ConversationMessage[];
}

// ─── Long-term memory ────────────────────────────────────────────────────────

export type MemoryType = 'goal' | 'insight' | 'preference' | 'context' | 'decision';

export interface MemoryItem {
  _id:        string;
  type:       MemoryType;
  content:    string;
  tags:       string[];
  importance: number;
  createdAt:  string;
}

// ─── Provider ────────────────────────────────────────────────────────────────

export interface ProviderResponse {
  provider:      string;
  hasGlobalKey:  boolean;
}

// ─── API responses ────────────────────────────────────────────────────────────

export interface DashboardResponse {
  intent:    'dashboard';
  chart:     DashboardSpec;
  sessionId: string;
  messageId: string;
}

export interface ReportResponse {
  intent:          'report';
  reportSections?: ReportSection[];
  sessionId:       string;
  messageId:       string;
}

export interface InquiryResponse {
  intent:     'general_question' | 'inquiry';
  summary?:   string;
  sessionId:  string;
  messageId:  string;
}

export type AnalyticsResponse = DashboardResponse | ReportResponse | InquiryResponse;

