import { getMongo } from './mongo.client.js';
import type { PermissionScope } from '../types/index.js';

const MAX_PIPELINE_STAGES = 25;
const AGGREGATION_TIMEOUT_MS = 30_000;
const blockedStages = new Set(['$function', '$merge', '$out', '$where']);

export function enforceAggregationSafety(
  pipeline: Record<string, unknown>[],
  scope: PermissionScope,
): Record<string, unknown>[] {
  if (pipeline.length > MAX_PIPELINE_STAGES) {
    throw new Error(`Pipeline exceeds ${MAX_PIPELINE_STAGES} stages.`);
  }
  for (const stage of pipeline) {
    for (const key of Object.keys(stage)) {
      if (blockedStages.has(key)) throw new Error(`Blocked stage '${key}'.`);
    }
  }
  const safe = [...pipeline];
  const scopeMatch = {
    tenantId: scope.tenantId,
    ...(scope.rowFilter ?? {}),
  };
  const firstMatch = safe[0]?.$match as Record<string, unknown> | undefined;
  if (!firstMatch) {
    safe.unshift({ $match: scopeMatch });
    return safe;
  }

  safe[0] = {
    $match: {
      $and: [scopeMatch, firstMatch],
    },
  };

  return safe;
}

export async function executePipeline({
  pipeline,
  collection,
  scope,
}: {
  pipeline: Record<string, unknown>[];
  collection: string;
  scope: PermissionScope;
}) {
  const safe = enforceAggregationSafety(pipeline, scope);
  const mongo = await getMongo();
  const rows = (await mongo.db
    .collection(collection)
    .aggregate(safe, { allowDiskUse: true, maxTimeMS: AGGREGATION_TIMEOUT_MS })
    .toArray()) as Record<string, unknown>[];
  return { rows };
}

export function executePipelineInMemory({
  pipeline,
  rows,
  scope,
}: {
  pipeline: Record<string, unknown>[];
  rows: Record<string, unknown>[];
  scope: PermissionScope;
}) {
  const safe = enforceAggregationSafetyForRows(pipeline, scope, rows);
  let current = rows.map((row) => ({ ...row }));

  for (const stage of safe) {
    if (stage.$match) {
      current = current.filter((row) => matchesQuery(row, stage.$match));
      continue;
    }

    if (stage.$group) {
      current = groupRows(current, stage.$group as Record<string, unknown>);
      continue;
    }

    if (stage.$project) {
      current = current.map((row) => projectRow(row, stage.$project as Record<string, unknown>));
      continue;
    }

    if (stage.$sort) {
      current = sortRows(current, stage.$sort as Record<string, unknown>);
      continue;
    }

    if (stage.$limit) {
      const limit = Number(stage.$limit);
      current = Number.isFinite(limit) && limit >= 0 ? current.slice(0, limit) : current;
      continue;
    }

    if (stage.$unwind) {
      current = unwindRows(current, stage.$unwind as Record<string, unknown> | string);
      continue;
    }

    if (stage.$lookup) {
      throw new Error('In-memory execution does not support $lookup. Provide already joined JSON rows instead.');
    }

    const operator = Object.keys(stage)[0] ?? 'unknown';
    throw new Error(`Unsupported in-memory pipeline stage "${operator}".`);
  }

  return { rows: current };
}

export function validateRows(rows: Record<string, unknown>[]): {
  rows: Record<string, string | number | boolean | null>[];
  schema: Record<string, string>;
} {
  if (rows.length === 0) return { rows: [], schema: {} };

  const schema: Record<string, string> = {};
  for (const key of Object.keys(rows[0])) {
    schema[key] = inferType(rows[0][key]);
  }

  const clean = rows.map((row) => {
    const out: Record<string, string | number | boolean | null> = {};
    for (const [k, v] of Object.entries(row)) {
      if (v === null || v === undefined) out[k] = null;
      else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
      else if (v instanceof Date) out[k] = v.toISOString();
      else out[k] = String(v);
    }
    return out;
  });

  return { rows: clean, schema };
}

function inferType(v: unknown): string {
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  if (v instanceof Date) return 'datetime';
  return 'string';
}

function enforceAggregationSafetyForRows(
  pipeline: Record<string, unknown>[],
  scope: PermissionScope,
  rows: Record<string, unknown>[],
) {
  if (pipeline.length > MAX_PIPELINE_STAGES) {
    throw new Error(`Pipeline exceeds ${MAX_PIPELINE_STAGES} stages.`);
  }
  for (const stage of pipeline) {
    for (const key of Object.keys(stage)) {
      if (blockedStages.has(key)) throw new Error(`Blocked stage '${key}'.`);
    }
  }

  const availableFields = new Set(rows.flatMap((row) => Object.keys(row)));
  const scopedFilters = Object.fromEntries(
    Object.entries({
      tenantId: scope.tenantId,
      ...(scope.rowFilter ?? {}),
    }).filter(([key]) => availableFields.has(key)),
  );
  if (Object.keys(scopedFilters).length === 0) return [...pipeline];

  const safe = [...pipeline];
  const firstMatch = safe[0]?.$match as Record<string, unknown> | undefined;
  if (!firstMatch) {
    safe.unshift({ $match: scopedFilters });
    return safe;
  }

  safe[0] = {
    $match: {
      $and: [scopedFilters, firstMatch],
    },
  };

  return safe;
}

function matchesQuery(row: Record<string, unknown>, query: unknown): boolean {
  if (!query || typeof query !== 'object' || Array.isArray(query)) return false;
  const clauses = Object.entries(query as Record<string, unknown>);
  return clauses.every(([key, value]) => {
    if (key === '$and') return Array.isArray(value) && value.every((item) => matchesQuery(row, item));
    if (key === '$or') return Array.isArray(value) && value.some((item) => matchesQuery(row, item));
    if (key === '$nor') return Array.isArray(value) && value.every((item) => !matchesQuery(row, item));
    return matchesFieldCondition(getValueByPath(row, key), value);
  });
}

function matchesFieldCondition(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof Date)) {
    return Object.entries(expected as Record<string, unknown>).every(([operator, value]) => {
      switch (operator) {
        case '$eq': return compareValues(actual, value) === 0;
        case '$ne': return compareValues(actual, value) !== 0;
        case '$gt': return compareValues(actual, value) > 0;
        case '$gte': return compareValues(actual, value) >= 0;
        case '$lt': return compareValues(actual, value) < 0;
        case '$lte': return compareValues(actual, value) <= 0;
        case '$in': return Array.isArray(value) && value.some((item) => compareValues(actual, item) === 0);
        case '$nin': return Array.isArray(value) && value.every((item) => compareValues(actual, item) !== 0);
        case '$regex': return buildRegex(value, (expected as Record<string, unknown>).$options).test(String(actual ?? ''));
        default: return compareValues(actual, expected) === 0;
      }
    });
  }
  return compareValues(actual, expected) === 0;
}

function groupRows(rows: Record<string, unknown>[], spec: Record<string, unknown>) {
  const idExpr = spec._id;
  const accumulators = Object.entries(spec).filter(([key]) => key !== '_id');
  const groups = new Map<string, { key: unknown; rows: Record<string, unknown>[] }>();

  for (const row of rows) {
    const key = evaluateExpression(idExpr, row);
    const serialized = JSON.stringify(key);
    const bucket = groups.get(serialized);
    if (bucket) {
      bucket.rows.push(row);
    } else {
      groups.set(serialized, { key, rows: [row] });
    }
  }

  return [...groups.values()].map(({ key, rows: bucketRows }) => {
    const out: Record<string, unknown> = { _id: key };
    for (const [field, accumulator] of accumulators) {
      out[field] = applyAccumulator(accumulator, bucketRows);
    }
    return out;
  });
}

function applyAccumulator(spec: unknown, rows: Record<string, unknown>[]) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return null;
  const [operator, expression] = Object.entries(spec as Record<string, unknown>)[0] ?? [];
  switch (operator) {
    case '$sum':
      return rows.reduce((sum, row) => sum + Number(evaluateAccumulatorOperand(expression, row) ?? 0), 0);
    case '$avg': {
      const values = rows
        .map((row) => Number(evaluateAccumulatorOperand(expression, row)))
        .filter((value) => !Number.isNaN(value));
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    }
    case '$min': {
      const values = rows.map((row) => evaluateAccumulatorOperand(expression, row)).filter((value) => value !== undefined);
      return values.length ? values.reduce((min, value) => (compareValues(value, min) < 0 ? value : min)) : null;
    }
    case '$max': {
      const values = rows.map((row) => evaluateAccumulatorOperand(expression, row)).filter((value) => value !== undefined);
      return values.length ? values.reduce((max, value) => (compareValues(value, max) > 0 ? value : max)) : null;
    }
    default:
      throw new Error(`Unsupported accumulator "${String(operator)}" in in-memory execution.`);
  }
}

function projectRow(row: Record<string, unknown>, spec: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [field, expression] of Object.entries(spec)) {
    if (expression === 0 || expression === false) continue;
    if (expression === 1 || expression === true) {
      out[field] = row[field];
      continue;
    }
    out[field] = evaluateExpression(expression, row);
  }
  return out;
}

function sortRows(rows: Record<string, unknown>[], spec: Record<string, unknown>) {
  const entries = Object.entries(spec).map(([field, direction]) => [field, Number(direction) >= 0 ? 1 : -1] as const);
  return [...rows].sort((a, b) => {
    for (const [field, direction] of entries) {
      const comparison = compareValues(getValueByPath(a, field), getValueByPath(b, field));
      if (comparison !== 0) return comparison * direction;
    }
    return 0;
  });
}

function unwindRows(rows: Record<string, unknown>[], spec: Record<string, unknown> | string) {
  const path = typeof spec === 'string' ? spec : String(spec.path ?? '');
  const field = path.replace(/^\$/, '');
  const preserveNullAndEmptyArrays = typeof spec === 'string' ? false : Boolean(spec.preserveNullAndEmptyArrays);
  const out: Record<string, unknown>[] = [];

  for (const row of rows) {
    const value = getValueByPath(row, field);
    if (Array.isArray(value) && value.length > 0) {
      for (const item of value) {
        const next = { ...row };
        setValueByPath(next, field, item);
        out.push(next);
      }
      continue;
    }

    if (preserveNullAndEmptyArrays) out.push({ ...row });
  }

  return out;
}

function evaluateAccumulatorOperand(expression: unknown, row: Record<string, unknown>) {
  if (expression === 1) return 1;
  return evaluateExpression(expression, row);
}

function evaluateExpression(expression: unknown, row: Record<string, unknown>): unknown {
  if (typeof expression === 'string') {
    return expression.startsWith('$') ? getValueByPath(row, expression.slice(1)) : expression;
  }

  if (expression instanceof Date || typeof expression === 'number' || typeof expression === 'boolean' || expression === null) {
    return expression;
  }

  if (Array.isArray(expression)) return expression.map((item) => evaluateExpression(item, row));

  if (!expression || typeof expression !== 'object') return expression;

  if ('$dateToString' in (expression as Record<string, unknown>)) {
    return evaluateDateToString((expression as Record<string, unknown>).$dateToString, row);
  }

  return Object.fromEntries(
    Object.entries(expression as Record<string, unknown>).map(([key, value]) => [key, evaluateExpression(value, row)]),
  );
}

function evaluateDateToString(spec: unknown, row: Record<string, unknown>) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return null;
  const format = String((spec as Record<string, unknown>).format ?? '%Y-%m-%d');
  const rawDate = evaluateExpression((spec as Record<string, unknown>).date, row);
  const date = rawDate instanceof Date ? rawDate : new Date(String(rawDate ?? ''));
  if (Number.isNaN(date.getTime())) return null;

  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return format.replace('%Y', String(year)).replace('%m', month).replace('%d', day);
}

function getValueByPath(row: Record<string, unknown>, path: string) {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, row);
}

function setValueByPath(row: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.');
  let current: Record<string, unknown> = row;
  for (let index = 0; index < parts.length - 1; index++) {
    const key = parts[index];
    const next = current[key];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[parts.at(-1) ?? path] = value;
}

function compareValues(left: unknown, right: unknown) {
  if (left === right) return 0;
  if (left === undefined || left === null) return -1;
  if (right === undefined || right === null) return 1;

  const leftDate = normalizeDate(left);
  const rightDate = normalizeDate(right);
  if (leftDate !== null && rightDate !== null) return leftDate - rightDate;

  if (typeof left === 'number' && typeof right === 'number') return left - right;
  if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right);
  return String(left).localeCompare(String(right));
}

function normalizeDate(value: unknown) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function buildRegex(pattern: unknown, options: unknown) {
  if (pattern instanceof RegExp) return pattern;
  return new RegExp(String(pattern ?? ''), typeof options === 'string' ? options : '');
}
