import { z } from 'zod';
import { taskPlanSchema } from './schemas/intent.js';
import type { Blueprint, DataStore } from '../types/index.js';

type TaskPlan = z.infer<typeof taskPlanSchema>;

interface FinalizeTaskPlanInput {
  plan: TaskPlan;
  prompt: string;
  availableBlueprints: Blueprint[];
  forcedIntent?: TaskPlan['intent'];
}

export function finalizeTaskPlan({
  plan,
  prompt,
  availableBlueprints,
  forcedIntent,
}: FinalizeTaskPlanInput): TaskPlan {
  const query: TaskPlan['query'] = { ...plan.query };

  const blueprint = resolveBlueprint(availableBlueprints, query.blueprintId, query.dataStoreName);
  const dataStore = blueprint
    ? resolveDataStore(blueprint, query.dataStoreName)
    : resolveDataStoreAcrossBlueprints(availableBlueprints, query.dataStoreName);

  if (blueprint) {
    query.blueprintId = blueprint.id;
  } else if (dataStore) {
    query.blueprintId = availableBlueprints.find((bp) =>
      bp.dataStores.some((candidate) => candidate.name === dataStore.name),
    )?.id;
  }

  if (dataStore) {
    query.dataStoreName = dataStore.name;
    query.metric = normalizeFieldName(query.metric, dataStore, ['measure']);
    query.dimensions = resolvePromptDimensions({
      prompt,
      current: normalizeFieldList(query.dimensions, dataStore, ['dimension', 'temporal']),
      dataStore,
    });
    query.filters = mergeFilters(normalizeFilters(query.filters, dataStore),
     inferPromptFilters(prompt, dataStore));
    query.sort = normalizeSort(query.sort, dataStore);
    query.timeRange = normalizeTimeRange(query.timeRange, prompt, dataStore);
  }

  if (query.aggregation === 'count') {
    query.metric = undefined;
  }

  const finalizedQuery: TaskPlan['query'] = {
    ...query,
    dimensions: query.dimensions && query.dimensions.length > 0 ? query.dimensions : undefined,
    filters: query.filters && query.filters.length > 0 ? query.filters : undefined,
    sort: query.sort && query.sort.length > 0 ? query.sort : undefined,
  };

  return {
    ...plan,
    intent: forcedIntent ?? plan.intent,
    needsChart: forcedIntent === 'dashboard' ? true : plan.needsChart,
    chartHint: normalizeChartHint(plan.chartHint, query, dataStore),
    query: finalizedQuery,
  } as TaskPlan;
}

function resolveBlueprint(
  blueprints: Blueprint[],
  blueprintId: string | undefined,
  dataStoreName: string | undefined,
) {
  const normalizedId = normalizeToken(blueprintId);
  if (normalizedId) {
    const direct = blueprints.find(
      (bp) => normalizeToken(bp.id) === normalizedId || normalizeToken(bp.name) === normalizedId,
    );
    if (direct) return direct;
  }

  const normalizedStore = normalizeToken(dataStoreName);
  if (normalizedStore) {
    return blueprints.find((bp) =>
      bp.dataStores.some((ds) => normalizeToken(ds.name) === normalizedStore),
    );
  }

  return undefined;
}

function resolveDataStore(blueprint: Blueprint, dataStoreName: string | undefined) {
  const normalizedName = normalizeToken(dataStoreName);
  if (!normalizedName) return undefined;
  return blueprint.dataStores.find((ds) => normalizeToken(ds.name) === normalizedName);
}

function resolveDataStoreAcrossBlueprints(blueprints: Blueprint[], dataStoreName: string | undefined) {
  const normalizedName = normalizeToken(dataStoreName);
  if (!normalizedName) return undefined;
  for (const blueprint of blueprints) {
    const match = blueprint.dataStores.find((ds) => normalizeToken(ds.name) === normalizedName);
    if (match) return match;
  }
  return undefined;
}

function normalizeFieldList(
  values: string[] | undefined,
  dataStore: DataStore,
  roles: Array<'dimension' | 'measure' | 'temporal'>,
) {
  if (!values) return undefined;
  const unique = new Set<string>();
  for (const value of values) {
    const normalized = normalizeFieldName(value, dataStore, roles);
    if (normalized) unique.add(normalized);
  }
  return [...unique];
}

function resolvePromptDimensions({
  prompt,
  current,
  dataStore,
}: {
  prompt: string;
  current: string[] | undefined;
  dataStore: DataStore;
}) {
  const inferred = inferPromptDimensions(prompt, dataStore);
  if (inferred.length > 0) return inferred;
  return current;
}

function normalizeFieldName(
  value: string | undefined,
  dataStore: DataStore,
  allowedRoles: Array<'dimension' | 'measure' | 'temporal'>,
) {
  const normalizedValue = normalizeToken(value);
  if (!normalizedValue) return undefined;

  const direct = dataStore.fields.find(
    (field) => {
      const fieldRole = asSupportedFieldRole(field.role);
      return allowedRoles.includes(fieldRole) && normalizeToken(field.name) === normalizedValue;
    },
  );
  if (direct) return direct.name;

  if (/date|time|created|requestdate/i.test(value ?? '')) {
    const temporal = dataStore.fields.find((field) => isTemporalField(field));
    if (temporal) return temporal.name;
  }

  return undefined;
}

function normalizeFilters(filters: TaskPlan['query']['filters'], dataStore: DataStore) {
  if (!filters) return undefined;
  const normalized: NonNullable<TaskPlan['query']['filters']> = [];
  for (const filter of filters) {
    const field = normalizeFieldName(filter.field, dataStore, ['dimension', 'measure', 'temporal']);
    if (!field) continue;
    normalized.push({
      field,
      op: filter.op,
      value: filter.value,
    });
  }
  return normalized;
}

function normalizeSort(sort: TaskPlan['query']['sort'], dataStore: DataStore) {
  if (!sort) return undefined;
  return sort
    .map((entry) => ({
      ...entry,
      field:
        entry.field === 'value'
          ? 'value'
          : normalizeFieldName(entry.field, dataStore, ['dimension', 'measure', 'temporal']) ??
            entry.field,
    }))
    .filter((entry) => Boolean(entry.field));
}

function mergeFilters(
  current: TaskPlan['query']['filters'],
  inferred: TaskPlan['query']['filters'],
): TaskPlan['query']['filters'] {
  if (!current?.length) return inferred;
  if (!inferred?.length) return current;

  const merged = [...current];
  for (const filter of inferred) {
    const exists = merged.some((candidate) => candidate.field === filter.field && candidate.op === filter.op);
    if (!exists) merged.push(filter);
  }
  return merged;
}

function inferPromptFilters(prompt: string, dataStore: DataStore): TaskPlan['query']['filters'] {
  const lower = prompt.toLowerCase();
  const inferred: NonNullable<TaskPlan['query']['filters']> = [];

  const statusField = dataStore.fields.find((field) => field.name === 'status');
  if (statusField?.enumValues) {
    const statusMatch = lower.match(/status\s+is\s+([a-z_ -]+)/i);
    if (statusMatch) {
      const enumValue = matchEnumValue(statusMatch[1], statusField.enumValues);
      if (enumValue) {
        inferred.push({ field: 'status', op: 'eq', value: enumValue });
      }
    }
  }

  if (lower.includes('open permits') && statusField) {
    inferred.push({ field: 'status', op: 'in', value: ['submitted', 'under_review'] });
  }

  if (lower.includes('open service requests') && statusField) {
    inferred.push({ field: 'status', op: 'in', value: ['new', 'in_review', 'in_progress'] });
  }

  if (lower.includes('violations') && dataStore.fields.some((field) => field.name === 'outcome')) {
    inferred.push({ field: 'outcome', op: 'eq', value: 'violation' });
  }

  if (lower.includes('completed projects') && dataStore.fields.some((field) => field.name === 'stage')) {
    inferred.push({ field: 'stage', op: 'eq', value: 'completed' });
  }

  return inferred.length > 0 ? inferred : undefined;
}

function inferPromptDimensions(prompt: string, dataStore: DataStore) {
  const lower = prompt.toLowerCase();
  const aliases: Array<{ pattern: RegExp; field: string }> = [
    { pattern: /\bby\s+municipalit(?:y|ies)\b/, field: 'municipality' },
    { pattern: /\bby\s+zone\b/, field: 'zone' },
    { pattern: /\bby\s+district\b/, field: 'district' },
    { pattern: /\bby\s+contractor\b/, field: 'contractor' },
    { pattern: /\bby\s+status\b/, field: 'status' },
    { pattern: /\bby\s+outcome\b/, field: 'outcome' },
    { pattern: /\bby\s+inspection\s+type\b/, field: 'inspectionType' },
    { pattern: /\bby\s+inspector\s+team\b/, field: 'inspectorTeam' },
    { pattern: /\bby\s+project\s+type\b/, field: 'projectType' },
    { pattern: /\bby\s+permit\s+type\b/, field: 'permitType' },
    { pattern: /\bby\s+topic\b/, field: 'topic' },
    { pattern: /\bby\s+channel\b/, field: 'channel' },
    { pattern: /\bby\s+priority\b/, field: 'priority' },
    { pattern: /\bby\s+stage\b/, field: 'stage' },
    { pattern: /\bby\s+applicant\s+type\b/, field: 'applicantType' },
    { pattern: /\bby\s+service\s+type\b/, field: 'serviceType' },
    { pattern: /\bby\s+name\b/, field: 'name' },
  ];

  const inferred: string[] = [];
  for (const alias of aliases) {
    if (!alias.pattern.test(lower)) continue;
    const normalized = normalizeFieldName(alias.field, dataStore, ['dimension']);
    if (normalized && !inferred.includes(normalized)) inferred.push(normalized);
  }

  return inferred;
}

function normalizeTimeRange(
  timeRange: TaskPlan['query']['timeRange'],
  prompt: string,
  dataStore: DataStore,
) {
  const field =
    normalizeFieldName(timeRange?.field, dataStore, ['temporal']) ??
    dataStore.fields.find((candidate) => isTemporalField(candidate))?.name;

  if (!field) return undefined;

  const inferred = inferRelativeTimeRange(prompt, field);
  if (inferred) return inferred;

  if (!timeRange) return undefined;
  return {
    field,
    from: timeRange.from,
    to: timeRange.to,
  };
}

function inferRelativeTimeRange(prompt: string, field: string) {
  const lower = prompt.toLowerCase();
  const now = new Date();

  if (lower.includes('today')) {
    return {
      field,
      from: startOfDay(now).toISOString(),
      to: endOfDay(now).toISOString(),
    };
  }

  if (lower.includes('yesterday')) {
    const day = shiftDays(now, -1);
    return {
      field,
      from: startOfDay(day).toISOString(),
      to: endOfDay(day).toISOString(),
    };
  }

  const lastDays = lower.match(/last\s+(\d+)\s+days?/i);
  if (lastDays) {
    const days = Number(lastDays[1]);
    return {
      field,
      from: startOfDay(shiftDays(now, -days)).toISOString(),
      to: endOfDay(now).toISOString(),
    };
  }

  if (lower.includes('recent')) {
    return {
      field,
      from: startOfDay(shiftDays(now, -30)).toISOString(),
      to: endOfDay(now).toISOString(),
    };
  }

  if (lower.includes('this month')) {
    return {
      field,
      from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
      to: endOfDay(now).toISOString(),
    };
  }

  if (lower.includes('this year') || /\bytd\b/i.test(lower)) {
    return {
      field,
      from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString(),
      to: endOfDay(now).toISOString(),
    };
  }

  return undefined;
}

function shiftDays(date: Date, delta: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + delta);
  return next;
}

function startOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function endOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function normalizeToken(value: string | undefined) {
  return value?.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function matchEnumValue(rawValue: string, enumValues: string[]) {
  const normalized = normalizeToken(rawValue.trim());
  if (!normalized) return undefined;
  return enumValues.find((value) => normalizeToken(value) === normalized);
}

function normalizeChartHint(
  chartHint: TaskPlan['chartHint'],
  query: TaskPlan['query'],
  dataStore: DataStore | undefined,
): TaskPlan['chartHint'] {
  if (chartHint !== 'trend' || !dataStore) return chartHint;

  const temporalFields = new Set(
    dataStore.fields.filter((field) => isTemporalField(field)).map((field) => field.name),
  );
  const dimensions = query.dimensions ?? [];
  if (dimensions.some((dimension) => temporalFields.has(dimension))) {
    return 'trend';
  }

  return 'compare';
}

function asSupportedFieldRole(
  role: DataStore['fields'][number]['role'],
): 'dimension' | 'measure' | 'temporal' {
  const rawRole = role as string | undefined;
  return rawRole === 'measure' || rawRole === 'temporal' || rawRole === 'dimension'
    ? rawRole
    : 'dimension';
}

function isTemporalField(field: DataStore['fields'][number]) {
  const rawRole = field.role as string | undefined;
  return rawRole === 'temporal' || field.type === 'date' || field.type === 'datetime';
}
