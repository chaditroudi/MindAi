import { z } from 'zod';
import { taskPlanSchema } from './schemas/intent.js';
import type { DataStore } from '../types/index.js';

type TaskPlan = z.infer<typeof taskPlanSchema>;

interface FinalizeTaskPlanInput {
  plan: TaskPlan;
  prompt: string;
  availableDataStores: DataStore[];
  forcedIntent?: TaskPlan['intent'];
}

export function finalizeTaskPlan({
  plan,
  prompt,
  availableDataStores,
  forcedIntent,
}: FinalizeTaskPlanInput): TaskPlan {
  const query: TaskPlan['query'] = { ...plan.query };

  const dataStore = resolveDataStore(availableDataStores, query.dataStoreName);

  if (dataStore) {
    query.dataStoreName = dataStore.name;
    query.metric = normalizeFieldName(query.metric, dataStore, ['measure']);
    query.metrics = normalizeFieldList(query.metrics, dataStore, ['measure']);
    query.dimensions = resolvePromptDimensions({
      prompt,
      current: normalizeFieldList(query.dimensions, dataStore, ['dimension', 'temporal']),
      dataStore,
    });
    query.filters = mergeFilters(
      normalizeFilters(query.filters, dataStore),
      inferPromptFilters(prompt, dataStore),
    );
    query.sort = normalizeSort(query.sort, dataStore);
    query.timeRange = normalizeTimeRange(query.timeRange, prompt, dataStore);
    query.dimensions = ensureTrendDimension({
      dimensions: query.dimensions,
      chartHint: inferChartHint(prompt, plan.chartHint, query, dataStore),
      timeRange: query.timeRange,
      dataStore,
    });
    query.topN = query.topN ?? inferTopN(prompt);
    query.percentOf = query.percentOf ?? inferPercentOf(prompt, query.metric);
  }

  if (query.aggregation === 'count') {
    query.metric = undefined;
  }

  const finalizedQuery: TaskPlan['query'] = {
    ...query,
    dimensions: query.dimensions && query.dimensions.length > 0 ? query.dimensions : undefined,
    metrics: query.metrics && query.metrics.length > 0 ? query.metrics : undefined,
    filters: query.filters && query.filters.length > 0 ? query.filters : undefined,
    sort: query.sort && query.sort.length > 0 ? query.sort : undefined,
  };

  const chartHint = normalizeChartHint(
    inferChartHint(prompt, plan.chartHint, query, dataStore),
    query,
    dataStore,
  );

  return {
    ...plan,
    intent: forcedIntent ?? plan.intent,
    needsChart: forcedIntent === 'dashboard' ? true : plan.needsChart,
    chartHint,
    query: finalizedQuery,
  } as TaskPlan;
}

function resolveDataStore(
  dataStores: DataStore[],
  dataStoreName: string | undefined,
) {
  const normalizedName = normalizeToken(dataStoreName);

  if (!normalizedName) return undefined;

  return dataStores.find((ds) => {
    return normalizeToken(ds.name) === normalizedName || normalizeToken(ds.collection) === normalizedName;
  });
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
  if (inferred.length === 0) return current;
  return dedupeStrings([...inferred, ...(current ?? [])]);
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
    const statusMatch = lower.match(/(?:status\s+is|الحالة(?:\s+هي)?|حالتها|حالته)\s+([a-z_ \-\u0600-\u06ff]+)/i);
    if (statusMatch) {
      const enumValue = resolveEnumQueryValue(statusMatch[1], statusField.enumValues);
      if (enumValue) {
        inferred.push({ field: 'status', op: 'eq', value: enumValue });
      }
    }
  }

  if ((lower.includes('open permits') || lower.includes('التصاريح المفتوحة')) && statusField) {
    inferred.push({ field: 'status', op: 'in', value: ['submitted', 'under_review'] });
  }

  if ((lower.includes('open service requests') || lower.includes('طلبات الخدمة المفتوحة')) && statusField) {
    inferred.push({ field: 'status', op: 'in', value: ['new', 'in_review', 'in_progress'] });
  }

  if ((lower.includes('violations') || lower.includes('مخالفة') || lower.includes('مخالفات'))
    && dataStore.fields.some((field) => field.name === 'outcome')) {
    inferred.push({ field: 'outcome', op: 'eq', value: 'violation' });
  }

  if ((lower.includes('completed projects') || lower.includes('المشاريع المكتملة'))
    && dataStore.fields.some((field) => field.name === 'stage')) {
    inferred.push({ field: 'stage', op: 'eq', value: 'completed' });
  }

  if (statusField?.enumValues) {
    for (const term of ['قيد المراجعة', 'تحت المراجعة', 'قيد التنفيذ', 'جديد', 'مكتمل', 'مكتملة']) {
      if (!lower.includes(term)) continue;
      const enumValue = resolveEnumQueryValue(term, statusField.enumValues);
      if (enumValue) inferred.push({ field: 'status', op: 'eq', value: enumValue });
    }
  }

  const priorityField = dataStore.fields.find((field) => field.name === 'priority');
  if ((lower.includes('urgent') || lower.includes('عاجل') || lower.includes('عاجلة'))
    && priorityField?.enumValues) {
    const enumValue = resolveEnumQueryValue('urgent', priorityField.enumValues);
    if (enumValue) inferred.push({ field: 'priority', op: 'eq', value: enumValue });
  }

  return inferred.length > 0 ? inferred : undefined;
}

function inferPromptDimensions(prompt: string, dataStore: DataStore) {
  const lower = prompt.toLowerCase();
  const aliases: Array<{ pattern: RegExp; field: string }> = [
    { pattern: /\bby\s+municipalit(?:y|ies)\b/, field: 'municipality' },
    { pattern: /حسب\s+البلدية/, field: 'municipality' },
    { pattern: /\bby\s+zone\b/, field: 'zone' },
    { pattern: /حسب\s+المنطقة/, field: 'zone' },
    { pattern: /\bby\s+district\b/, field: 'district' },
    { pattern: /حسب\s+الحي/, field: 'district' },
    { pattern: /\bby\s+contractor\b/, field: 'contractor' },
    { pattern: /حسب\s+المقاول/, field: 'contractor' },
    { pattern: /\bby\s+status\b/, field: 'status' },
    { pattern: /حسب\s+الحالة/, field: 'status' },
    { pattern: /\bby\s+outcome\b/, field: 'outcome' },
    { pattern: /حسب\s+النتيجة/, field: 'outcome' },
    { pattern: /\bby\s+inspection\s+type\b/, field: 'inspectionType' },
    { pattern: /حسب\s+نوع\s+التفتيش/, field: 'inspectionType' },
    { pattern: /\bby\s+inspector\s+team\b/, field: 'inspectorTeam' },
    { pattern: /حسب\s+فريق\s+التفتيش/, field: 'inspectorTeam' },
    { pattern: /\bby\s+project\s+type\b/, field: 'projectType' },
    { pattern: /حسب\s+نوع\s+المشروع/, field: 'projectType' },
    { pattern: /\bby\s+permit\s+type\b/, field: 'permitType' },
    { pattern: /حسب\s+نوع\s+التصريح/, field: 'permitType' },
    { pattern: /\bby\s+topic\b/, field: 'topic' },
    { pattern: /حسب\s+الموضوع/, field: 'topic' },
    { pattern: /\bby\s+channel\b/, field: 'channel' },
    { pattern: /حسب\s+القناة/, field: 'channel' },
    { pattern: /\bby\s+priority\b/, field: 'priority' },
    { pattern: /حسب\s+الأولوية/, field: 'priority' },
    { pattern: /\bby\s+stage\b/, field: 'stage' },
    { pattern: /حسب\s+المرحلة/, field: 'stage' },
    { pattern: /\bby\s+applicant\s+type\b/, field: 'applicantType' },
    { pattern: /حسب\s+نوع\s+مقدم\s+الطلب/, field: 'applicantType' },
    { pattern: /\bby\s+service\s+type\b/, field: 'serviceType' },
    { pattern: /حسب\s+نوع\s+الخدمة/, field: 'serviceType' },
    { pattern: /\bby\s+name\b/, field: 'name' },
    { pattern: /حسب\s+الاسم/, field: 'name' },
  ];

  const inferred: string[] = [];
  for (const alias of aliases) {
    if (!alias.pattern.test(lower)) continue;
    const normalized = normalizeFieldName(alias.field, dataStore, ['dimension']);
    if (normalized && !inferred.includes(normalized)) inferred.push(normalized);
  }

  const byClause = extractByClause(lower);
  if (byClause) {
    const normalizedClause = normalizeToken(byClause) ?? '';
    for (const field of dataStore.fields) {
      if (asSupportedFieldRole(field.role) !== 'dimension') continue;
      const fieldTokens = [
        field.name,
        splitIdentifier(field.name),
        field.name === 'municipality' ? 'municipalities' : undefined,
      ].filter((value): value is string => Boolean(value));

      if (!fieldTokens.some((token) => normalizedClause.includes(normalizeToken(token) ?? ''))) continue;

      const normalized = normalizeFieldName(field.name, dataStore, ['dimension']);
      if (normalized && !inferred.includes(normalized)) inferred.push(normalized);
    }
  }

  return inferred;
}

function extractByClause(prompt: string) {
  const match = prompt.match(/\bby\s+(.+?)(?:\bwhere\b|\bwith\b|\bover\b|\blast\b|\bthis\b|$)/i);
  if (match?.[1]) return match[1];

  const arabicMatch = prompt.match(/حسب\s+(.+?)(?:\s+حيث|\s+مع|\s+خلال|\s+آخر|\s+هذا|$)/i);
  return arabicMatch?.[1];
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

  if (lower.includes('today') || lower.includes('اليوم')) {
    return {
      field,
      from: startOfDay(now).toISOString(),
      to: endOfDay(now).toISOString(),
    };
  }

  if (lower.includes('yesterday') || lower.includes('أمس') || lower.includes('امس')) {
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

  const lastArabicDays = lower.match(/(?:آخر|خلال\s+آخر)\s+(\d+)\s+يو(?:م|ما|ماً|مًا)/i);
  if (lastArabicDays) {
    const days = Number(lastArabicDays[1]);
    return {
      field,
      from: startOfDay(shiftDays(now, -days)).toISOString(),
      to: endOfDay(now).toISOString(),
    };
  }

  if (lower.includes('recent') || lower.includes('حديثة') || lower.includes('حديث') || lower.includes('مؤخراً') || lower.includes('مؤخرا')) {
    return {
      field,
      from: startOfDay(shiftDays(now, -30)).toISOString(),
      to: endOfDay(now).toISOString(),
    };
  }

  if (lower.includes('this month') || lower.includes('هذا الشهر')) {
    return {
      field,
      from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
      to: endOfDay(now).toISOString(),
    };
  }

  if (lower.includes('this year') || /\bytd\b/i.test(lower) || lower.includes('هذا العام') || lower.includes('منذ بداية العام')) {
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
  return value?.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function splitIdentifier(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
}

function dedupeStrings(values: string[]) {
  return [...new Set(values)];
}

function matchEnumValue(rawValue: string, enumValues: string[]) {
  const normalized = normalizeToken(rawValue.trim());
  if (!normalized) return undefined;
  return enumValues.find((value) => normalizeToken(value) === normalized);
}

function resolveEnumQueryValue(rawValue: string, enumValues: string[]) {
  return matchEnumValue(localizeEnumValue(rawValue.trim()), enumValues)
    ?? matchEnumValue(rawValue.trim(), enumValues);
}

function localizeEnumValue(rawValue: string) {
  const normalized = normalizeToken(rawValue) ?? '';
  const synonyms: Record<string, string> = {
    جديد: 'new',
    جديدة: 'new',
    عاجل: 'urgent',
    عاجلة: 'urgent',
    قيدالمراجعة: 'under_review',
    تحتالمراجعة: 'under_review',
    قيدالتنفيذ: 'in_progress',
    قيدالعمل: 'in_progress',
    مكتمل: 'completed',
    مكتملة: 'completed',
    مخالفة: 'violation',
    مخالفه: 'violation',
    مقدم: 'submitted',
    مرسل: 'submitted',
    معتمد: 'approved',
    مرفوض: 'rejected',
    منتهي: 'expired',
  };

  return synonyms[normalized] ?? rawValue;
}

function inferTopN(prompt: string): number | undefined {
  const lower = prompt.toLowerCase();
  const match =
    lower.match(/\btop\s+(\d+)\b/i) ??
    lower.match(/\b(\d+)\s+(?:أعلى|أكثر|الأوائل|الأعلى)\b/) ??
    lower.match(/(?:أعلى|أكثر|الأعلى)\s+(\d+)/);
  if (match) {
    const n = Number(match[1]);
    if (n > 0 && n <= 100) return n;
  }
  return undefined;
}

function inferPercentOf(prompt: string, metric: string | undefined): string | undefined {
  if (!metric) return undefined;
  const lower = prompt.toLowerCase();
  const asksPercent =
    /\b(percent|percentage|share|proportion|نسبة|كنسبة|حصة)\b/i.test(lower);
  return asksPercent ? metric : undefined;
}

function normalizeChartHint(
  chartHint: TaskPlan['chartHint'],
  query: TaskPlan['query'],
  dataStore: DataStore | undefined,
): TaskPlan['chartHint'] {
  if (query.topN) return 'ranking';
  if (query.percentOf) return 'part_of_whole';
  if (chartHint !== 'trend' || !dataStore) return chartHint;

  const temporalFields = new Set(
    dataStore.fields.filter((field) => isTemporalField(field)).map((field) => field.name),
  );
  const dimensions = query.dimensions ?? [];
  if (dimensions.some((dimension) => temporalFields.has(dimension))) return 'trend';
  return query.timeRange?.field && temporalFields.has(query.timeRange.field) ? 'trend' : 'compare';
}

function inferChartHint(
  prompt: string,
  chartHint: TaskPlan['chartHint'],
  query: TaskPlan['query'],
  dataStore: DataStore | undefined,
): TaskPlan['chartHint'] {
  if (chartHint) return chartHint;

  const lower = prompt.toLowerCase();

  if (query.topN ?? inferTopN(prompt)) return 'ranking';

  if (/\b(percent|percentage|share|proportion|نسبة|كنسبة|حصة)\b/i.test(lower)) {
    return 'part_of_whole';
  }

  if (!dataStore?.fields.some((field) => isTemporalField(field))) return chartHint;

  const asksForTrend =
    /\b(trend|over time|timeline|daily|weekly|monthly|yearly|last\s+\d+\s+days?|this month|this year|ytd)\b/i.test(lower) ||
    /(اتجاه|زمني|يومي|يومياً|اسبوعي|أسبوعي|شهري|سنوياً|سنوي|آخر\s+\d+\s+يو|هذا الشهر|هذا العام)/i.test(lower);

  if (asksForTrend || query.timeRange) return 'trend';
  return chartHint;
}

function ensureTrendDimension({
  dimensions,
  chartHint,
  timeRange,
  dataStore,
}: {
  dimensions: string[] | undefined;
  chartHint: TaskPlan['chartHint'];
  timeRange: TaskPlan['query']['timeRange'];
  dataStore: DataStore;
}) {
  if (chartHint !== 'trend') return dimensions;

  const temporalField =
    (timeRange?.field && dataStore.fields.some((field) => field.name === timeRange.field && isTemporalField(field))
      ? timeRange.field
      : undefined) ??
    dataStore.fields.find((field) => isTemporalField(field))?.name;

  if (!temporalField) return dimensions;
  const current = dimensions ?? [];
  if (current.includes(temporalField)) return current;
  return [temporalField, ...current];
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
