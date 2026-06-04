import type { DataStore, DataStoreField, DataStoreJoin } from '../types/index.js';

const allowedStages = new Set([
  '$match',
  '$lookup',
  '$unwind',
  '$group',
  '$project',
  '$sort',
  '$limit',
  '$skip',
]);

type PipelineStage = Record<string, unknown>;

interface JoinDefinition {
  from: string;
  localField: string;
  foreignField: string;
  as?: string;
  foreignStore?: DataStore;
}

export function validatePipelineForDataStore({
  pipeline,
  dataStore,
  availableDataStores,
}: {
  pipeline: PipelineStage[];
  dataStore: DataStore;
  availableDataStores: DataStore[];
}): PipelineStage[] {
  const dataStoreByCollection = new Map(
    availableDataStores.map((candidate) => [candidate.collection, candidate]),
  );

  let availableFields = buildRootFieldSet(dataStore.fields);
  const allowedJoins = buildJoinDefinitions(dataStore, dataStoreByCollection);

  for (const stage of pipeline) {
    const operators = Object.keys(stage);
    if (operators.length !== 1) {
      throw new Error(`Each pipeline stage must contain exactly one operator. Received: ${operators.join(', ')}`);
    }

    const operator = operators[0];
    if (!allowedStages.has(operator)) {
      throw new Error(`Unsupported stage '${operator}'.`);
    }

    const value = stage[operator];
    switch (operator) {
      case '$match':
        validateMatchStage(value, availableFields);
        break;
      case '$lookup': {
        const joined = validateLookupStage(value, availableFields, allowedJoins);
        availableFields = extendFieldSet(availableFields, joined.as, joined.foreignStore?.fields ?? []);
        break;
      }
      case '$unwind':
        validateUnwindStage(value, availableFields);
        break;
      case '$group':
        availableFields = validateGroupStage(value, availableFields);
        break;
      case '$project':
        availableFields = validateProjectStage(value, availableFields);
        break;
      case '$sort':
        validateSortStage(value, availableFields);
        break;
      case '$limit':
      case '$skip':
        validatePositiveIntegerStage(value, operator);
        break;
      default:
        break;
    }
  }

  return pipeline;
}

function validateMatchStage(value: unknown, availableFields: Set<string>) {
  if (!isPlainObject(value)) throw new Error('Stage "$match" must be an object.');
  validateMatchExpression(value, availableFields);
}

function validateMatchExpression(expression: Record<string, unknown>, availableFields: Set<string>) {
  for (const [key, value] of Object.entries(expression)) {
    if (key === '$and' || key === '$or' || key === '$nor') {
      if (!Array.isArray(value)) throw new Error(`"${key}" in "$match" must be an array.`);
      for (const entry of value) {
        if (!isPlainObject(entry)) throw new Error(`Entries in "${key}" must be objects.`);
        validateMatchExpression(entry, availableFields);
      }
      continue;
    }

    if (key.startsWith('$')) {
      throw new Error(`Unsupported match operator "${key}".`);
    }

    assertFieldExists(key, availableFields, '$match');
    validateMatchCondition(value);
  }
}

function validateMatchCondition(condition: unknown) {
  if (!isPlainObject(condition)) return;

  for (const [op, value] of Object.entries(condition)) {
    if (!op.startsWith('$')) {
      validateMatchCondition(value);
      continue;
    }

    if (!['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin', '$regex', '$exists'].includes(op)) {
      throw new Error(`Unsupported "$match" condition operator "${op}".`);
    }

    if ((op === '$in' || op === '$nin') && !Array.isArray(value)) {
      throw new Error(`"${op}" requires an array value.`);
    }
  }
}

function validateLookupStage(
  value: unknown,
  availableFields: Set<string>,
  allowedJoins: JoinDefinition[],
) {
  if (!isPlainObject(value)) throw new Error('Stage "$lookup" must be an object.');

  const { from, localField, foreignField, as } = value as Record<string, unknown>;
  if (
    typeof from !== 'string'
    || typeof localField !== 'string'
    || typeof foreignField !== 'string'
    || typeof as !== 'string'
    || !as.trim()
  ) {
    throw new Error('Stage "$lookup" must include string from, localField, foreignField, and as properties.');
  }

  assertFieldExists(localField, availableFields, '$lookup.localField');

  const matchedJoin = allowedJoins.find((candidate) => {
    const aliasMatches = !candidate.as || candidate.as === as;
    return candidate.from === from
      && candidate.localField === localField
      && candidate.foreignField === foreignField
      && aliasMatches;
  });

  if (!matchedJoin) {
    throw new Error(
      `Lookup "${from}" via ${localField} -> ${foreignField} is not declared in datastore metadata.`,
    );
  }

  return { as, foreignStore: matchedJoin.foreignStore };
}

function validateUnwindStage(value: unknown, availableFields: Set<string>) {
  const path = extractPath(value, '$unwind');
  assertFieldExists(path, availableFields, '$unwind');
}

function validateGroupStage(value: unknown, availableFields: Set<string>) {
  if (!isPlainObject(value)) throw new Error('Stage "$group" must be an object.');
  if (!('_id' in value)) throw new Error('Stage "$group" must include "_id".');

  const nextFields = new Set<string>(['_id']);
  validateGroupId((value as Record<string, unknown>)['_id'], availableFields, nextFields);

  for (const [key, expression] of Object.entries(value as Record<string, unknown>)) {
    if (key === '_id') continue;
    if (!isPlainObject(expression)) {
      throw new Error(`Accumulator "${key}" in "$group" must be an object.`);
    }

    const operators = Object.keys(expression);
    if (operators.length !== 1) {
      throw new Error(`Accumulator "${key}" in "$group" must contain exactly one operator.`);
    }

    const operator = operators[0];
    if (!['$sum', '$avg', '$min', '$max', '$first', '$last', '$push', '$addToSet'].includes(operator)) {
      throw new Error(`Unsupported accumulator "${operator}" in "$group".`);
    }

    validateExpression((expression as Record<string, unknown>)[operator], availableFields);
    nextFields.add(key);
  }

  return nextFields;
}

function validateProjectStage(value: unknown, availableFields: Set<string>) {
  if (!isPlainObject(value)) throw new Error('Stage "$project" must be an object.');

  const nextFields = new Set<string>();
  for (const [key, expression] of Object.entries(value)) {
    if (expression === 0 || expression === false) continue;

    if (expression === 1 || expression === true) {
      assertFieldExists(key, availableFields, '$project');
      nextFields.add(key);
      continue;
    }

    validateExpression(expression, availableFields);
    nextFields.add(key);
  }

  return nextFields;
}

function validateSortStage(value: unknown, availableFields: Set<string>) {
  if (!isPlainObject(value)) throw new Error('Stage "$sort" must be an object.');

  for (const [field, direction] of Object.entries(value)) {
    assertFieldExists(field, availableFields, '$sort');
    if (direction !== 1 && direction !== -1) {
      throw new Error(`Sort direction for "${field}" must be 1 or -1.`);
    }
  }
}

function validatePositiveIntegerStage(value: unknown, operator: '$limit' | '$skip') {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`Stage "${operator}" must be a non-negative integer.`);
  }
}

function validateGroupId(
  value: unknown,
  availableFields: Set<string>,
  nextFields: Set<string>,
  prefix = '_id',
) {
  if (typeof value === 'string') {
    validateExpression(value, availableFields);
    return;
  }

  if (!isPlainObject(value)) {
    throw new Error('Stage "$group._id" must be a string field reference or object.');
  }

  for (const [key, nested] of Object.entries(value)) {
    validateExpression(nested, availableFields);
    nextFields.add(`${prefix}.${key}`);
  }
}

function validateExpression(value: unknown, availableFields: Set<string>) {
  if (typeof value === 'string') {
    if (value.startsWith('$$')) {
      throw new Error(`Unsupported expression variable "${value}".`);
    }
    if (value.startsWith('$')) {
      assertFieldExists(value.slice(1), availableFields, 'expression');
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) validateExpression(entry, availableFields);
    return;
  }

  if (!isPlainObject(value)) return;

  for (const [key, nested] of Object.entries(value)) {
    if (key.startsWith('$')) {
      validateExpression(nested, availableFields);
      continue;
    }
    validateExpression(nested, availableFields);
  }
}

function buildJoinDefinitions(
  dataStore: DataStore,
  dataStoreByCollection: Map<string, DataStore>,
) {
  const joins: JoinDefinition[] = [];

  for (const join of dataStore.joins ?? []) {
    joins.push({
      ...join,
      foreignStore: dataStoreByCollection.get(join.from),
    });
  }

  for (const field of dataStore.fields) {
    const derived = deriveJoinFromReference(field, dataStoreByCollection);
    if (!derived) continue;

    const exists = joins.some((candidate) => {
      return candidate.from === derived.from
        && candidate.localField === derived.localField
        && candidate.foreignField === derived.foreignField;
    });
    if (!exists) joins.push(derived);
  }

  return joins;
}

function deriveJoinFromReference(
  field: DataStoreField,
  dataStoreByCollection: Map<string, DataStore>,
): JoinDefinition | undefined {
  if (!field.referenceTo) return undefined;
  const [collection, foreignField] = field.referenceTo.split('.');
  if (!collection || !foreignField) return undefined;

  return {
    from: collection,
    localField: field.name,
    foreignField,
    foreignStore: dataStoreByCollection.get(collection),
  };
}

function buildRootFieldSet(fields: DataStoreField[]) {
  return new Set(fields.map((field) => field.name));
}

function extendFieldSet(
  current: Set<string>,
  alias: string,
  foreignFields: DataStoreField[],
) {
  const next = new Set(current);
  next.add(alias);
  for (const field of foreignFields) {
    next.add(`${alias}.${field.name}`);
  }
  return next;
}

function assertFieldExists(field: string, availableFields: Set<string>, context: string) {
  if (availableFields.has(field)) return;

  const root = field.split('.')[0];
  if (availableFields.has(root)) return;

  throw new Error(`Unknown field "${field}" in ${context}.`);
}

function extractPath(value: unknown, stageName: string) {
  if (typeof value === 'string') return normalizePath(value, stageName);
  if (!isPlainObject(value) || typeof value.path !== 'string') {
    throw new Error(`Stage "${stageName}" must be a string path or an object with "path".`);
  }
  return normalizePath(value.path, stageName);
}

function normalizePath(path: string, stageName: string) {
  const trimmed = path.trim().replace(/^\$/, '');
  if (!trimmed) throw new Error(`Stage "${stageName}" received an empty path.`);
  return trimmed;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
