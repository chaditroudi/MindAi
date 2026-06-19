import type { WidgetType } from '../ai/chart.js';
export type { WidgetType };

export type FieldType =
  | 'string' | 'number' | 'integer' | 'boolean'
  | 'date' | 'datetime' | 'enum' | 'reference'
  | 'array' | 'object' | 'geo' | 'text';

export interface DataSourceField {
  name:          string;
  label?:        string;
  description?:  string;
  type:          FieldType;
  role?:         'dimension' | 'measure' | 'temporal' | 'id' | 'text';
  enumValues?:   string[];
  referenceTo?:  string;
  sampleValues?: unknown[];
  searchable?:   boolean;
  tags?:         string[];
}

export interface DataSourceJoin {
  from:         string;
  localField:   string;
  foreignField: string;
  as:           string;
}

// Pre-built visualization suggestions stored in the source definition.
// The chart builder can consult these before asking the LLM, and the planner
// can use the bundled pipeline to avoid a round-trip aggregation decision.
export interface SuggestedChart {
  title:        string;
  description?: string;
  chartType:    WidgetType;
  labelField?:  string;
  valueField?:  string;
  xField?:      string;
  yField?:      string;
  seriesField?: string;
  agg?:         'sum' | 'avg' | 'count' | 'min' | 'max';
  pipeline?:    Record<string, unknown>[];
}

export interface DataSource {
  name:              string;
  collection:        string;
  description?:      string;
  tags?:             string[];
  fields:            DataSourceField[];
  joins?:            DataSourceJoin[];
  suggestedCharts?:  SuggestedChart[];
}

export type IntentKind = 'general_question' | 'report' | 'dashboard';
export type SkillKind  = 'standard' | 'trend' | 'comparison' | 'anomaly' | 'overview';
export type ExecutionSkillKind = 'aggregation' | 'chart' | 'report' | 'inquiry';

export interface WidgetSpec {
  id:       string;
  type:     WidgetType;
  title:    string;
  insight?: string;
  option?:  Record<string, unknown>;
  columns?: string[];
  rows?:    Record<string, unknown>[];
  value?:   number;
}

export interface DashboardSpec {
  layout:  'executive' | 'analytical' | 'operational';
  title:   string;
  summary: string;
  widgets: WidgetSpec[];
}

export type ChartHint = string;

export interface TaskQuery {
  sourceId?:   string;
  sourceName?: string;
  limit?:      number;
}

export interface TaskPlan {
  needsData:  boolean;
  query:      TaskQuery;
  skills:     ExecutionSkillKind[];
  chartHint?: ChartHint;
  strategy?:  SkillKind;
  pipeline?:  Record<string, unknown>[];
  wantChart?: boolean;
}
