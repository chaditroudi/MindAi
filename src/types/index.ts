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
  | 'geo';

export interface BlueprintField {
  name: string;
  description?: string;
  type: FieldType;
  enumValues?: string[];
  referenceTo?: string;
  role?: 'id';
}

export interface DataStore {
  name: string;
  collection: string;
  description?: string;
  fields: BlueprintField[];
}

export interface Blueprint {
  id: string;
  name: string;
  description?: string;
  dataStores: DataStore[];
}

export interface PlatformDefinition {
  blueprints: Blueprint[];
}

export interface PermissionScope {
  userId: string;
  tenantId: string;
  allowedBlueprintIds: string[];
  rowFilter?: Record<string, unknown>;
}

export type IntentKind =
  | 'general_question'
  | 'report'
  | 'dashboard';

export interface RequestContext {
  prompt: string;
  intent?: IntentKind;
  topic?: string;
  blueprintId?: string;
  dataStoreName?: string;
  scope: PermissionScope;
  locale?: string;
  theme?: 'light' | 'dark' | 'brand';
}

export type DatasetRow = Record<string, string | number | boolean | null>;

export interface Dataset {
  rows: DatasetRow[];
  schema: Record<string, FieldType>;
  source: 'mongodb' | 'search' | 'merged';
  citations?: Citation[];
}

export interface Citation {
  title: string;
  url?: string;
  snippet?: string;
}

export interface ChartResult {
  chartType:
    | 'line'
    | 'bar'
    | 'horizontalBar'
    | 'scatter'
    | 'donut'
    | 'map'
    | 'histogram'
    | 'table';
  option: Record<string, unknown>;
  title: string;
  annotations?: string[];
  accessibility: { description: string };
}

export interface SupervisorResponse {
  intent: IntentKind;
  summary?: string;
  recordLinks?: Array<{ collection: string; id: string; label: string }>;
  reportSections?: Array<{ heading: string; body: string }>;
  charts?: ChartResult[];
  audit: {
    plan: TaskPlan;
    pipeline?: object[];
    citations?: Citation[];
    elapsedMs: number;
  };
}

export interface TaskPlan {
  intent: IntentKind;
  needsData: boolean;
  needsEnrichment: boolean;
  needsChart: boolean;
  query: {
    blueprintId?: string;
    dataStoreName?: string;
    metric?: string;
    aggregation?: 'sum' | 'avg' | 'count' | 'min' | 'max';
    dimensions?: string[];
    timeRange?: { field: string; from?: string; to?: string };
    filters?: Array<{ field: string; op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in'; value: unknown }>;
    sort?: Array<{ field: string; dir: 'asc' | 'desc' }>;
    limit?: number;
  };
  enrichment?: {
    topic: string;
    dimensions: string[];
    sources?: string[];
  };
  chartHint?: 'compare' | 'trend' | 'distribution' | 'part_of_whole' | 'geo';
}
