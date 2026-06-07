export type FieldType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'enum'
  | 'reference'
  | 'array'
  | 'object'
  | 'geo'
  | 'text';

export interface DataSourceField {
  name: string;
  label?: string;
  description?: string;
  type: FieldType;
  role?: 'dimension' | 'measure' | 'temporal' | 'id' | 'text';
  enumValues?: string[];
  referenceTo?: string;
  sampleValues?: unknown[];
  searchable?: boolean;
  tags?: string[];
}

export interface DataSourceJoin {
  from: string;
  localField: string;
  foreignField: string;
  as: string;
}

export interface SchemaStructureField {
  name: string;
  type?: FieldType | string;
  desc?: string;
  description?: string;
}

export interface SchemaStructureCollection {
  collection: string;
  name?: string;
  fields: SchemaStructureField[];
  description?: string;
}

export interface DataSource {
  name: string;
  collection: string;
  description?: string;
  tags?: string[];
  fields: DataSourceField[];
  joins?: DataSourceJoin[];
}

export type IntentKind = 'general_question' | 'report' | 'dashboard';

export type DatasetRow = Record<string, string | number | boolean | null>;

export interface Dataset {
  rows: DatasetRow[];
  schema: Record<string, FieldType>;
  jsonSchema?: Record<string, unknown>;
  source: 'mongodb' | 'search' | 'merged';
  citations?: Citation[];
}

export interface Citation {
  title: string;
  url?: string;
  snippet?: string;
}

export type Aggregation = 'sum' | 'avg' | 'count' | 'min' | 'max';

export type FilterOperator = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin' | 'regex';

export interface Filter {
  field: string;
  op: FilterOperator;
  value?: unknown;
}

export interface Lookup {
  from: string;
  localField: string;
  foreignField: string;
  as: string;
}

export interface HavingClause {
  field: string;
  op: 'gt' | 'gte' | 'lt' | 'lte' | 'eq';
  value: number;
}

export interface SortClause {
  field: string;
  dir: 'asc' | 'desc';
}

export interface TimeRange {
  field: string;
  from?: string;
  to?: string;
}

export interface TaskQuery {
  sourceId?: string;
  sourceName?: string;
  metric?: string;
  metrics?: string[];
  aggregation?: Aggregation;
  dimensions?: string[];
  topN?: number;
  percentOf?: string;
  having?: HavingClause;
  lookups?: Lookup[];
  timeRange?: TimeRange;
  filters?: Filter[];
  sort?: SortClause[];
  limit?: number;
}

export interface EnrichmentPlan {
  topic: string;
  dimensions: string[];
  timeRange?: TimeRange;
  language?: string;
  locale?: string;
  sources?: string[];
}

export type ChartHint = 'compare' | 'trend' | 'distribution' | 'part_of_whole' | 'geo' | 'ranking';

export interface TaskPlan {
  intent: IntentKind;
  needsData: boolean;
  needsEnrichment: boolean;
  needsChart: boolean;
  query: TaskQuery;
  enrichment?: EnrichmentPlan;
  chartHint?: ChartHint;
  pipeline?: Record<string, unknown>[];
}
