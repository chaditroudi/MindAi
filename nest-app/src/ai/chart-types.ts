export type DataRow   = Record<string, unknown>;
export type FieldKind = 'numeric' | 'temporal' | 'categorical';

export interface RowProfile {
  all:         string[];
  numeric:     string[];
  temporal:    string[];
  categorical: string[];
}

export interface WidgetPlan {
  type:          string;
  title:         string;
  insight?:      string;
  labelField?:   string;
  valueField?:   string;
  xField?:       string;
  yField?:       string;
  seriesField?:  string;
  columns?:      string[];
  agg?:          'sum' | 'avg' | 'count' | 'min' | 'max';
  sortDesc?:     boolean;
  topN?:         number;
  chartOptions?: Record<string, unknown>;
}

export type Renderer = (plan: WidgetPlan, data: DataRow[], id: string) => unknown;
