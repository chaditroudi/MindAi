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

export interface DataStoreField {
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

export interface DataStoreJoin {
  from: string;
  localField: string;
  foreignField: string;
  as: string;
}

export interface DataStore {
  name: string;
  collection: string;
  description?: string;
  tags?: string[];
  fields: DataStoreField[];
  joins?: DataStoreJoin[];
}

export interface PermissionScope {
  userId: string;
  tenantId: string;
  allowedDataStores?: string[];
  rowFilter?: Record<string, unknown>;
}

export type IntentKind = 'general_question' | 'report' | 'dashboard';

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

export interface TaskPlan {
  intent: IntentKind;
  needsData: boolean;
  needsEnrichment: boolean;
  needsChart: boolean;
  query: {
    dataStoreName?: string;
    metric?: string;
    metrics?: string[];
    aggregation?: 'sum' | 'avg' | 'count' | 'min' | 'max';
    dimensions?: string[];
    topN?: number;
    percentOf?: string;
    having?: { field: string; op: 'gt' | 'gte' | 'lt' | 'lte' | 'eq'; value: number };
    lookups?: Array<{ from: string; localField: string; foreignField: string; as: string }>;
    timeRange?: { field: string; from?: string; to?: string };
    filters?: Array<{
      field: string;
      op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin' | 'regex';
      value: unknown;
    }>;
    sort?: Array<{ field: string; dir: 'asc' | 'desc' }>;
    limit?: number;
  };
  enrichment?: {
    topic: string;
    dimensions: string[];
    sources?: string[];
  };
  chartHint?: 'compare' | 'trend' | 'distribution' | 'part_of_whole' | 'geo' | 'ranking';
}
