import type {
  ConversationRef,
  DataStore,
  DataStoreField,
  DataStoreJoin,
  FieldType,
  SchemaStructureCollection,
} from '../types/index.js';
import { PRINCIPAL_SUPERVISOR_DATASTORES } from '../config/principal-supervisor-structure.js';

const schemaContextCache = new Map<string, DataStore[]>();

export function loadSchemaContext(ref: ConversationRef): DataStore[] | undefined {
  return schemaContextCache.get(cacheKey(ref));
}

export function saveSchemaContext(ref: ConversationRef, datastores: DataStore[]) {
  if (datastores.length === 0) return;
  schemaContextCache.set(cacheKey(ref), datastores);
}

export function resolveSchemaContext({
  ref,
  datastores,
  schemaStructure,
  prompt,
}: {
  ref: ConversationRef;
  datastores?: DataStore[];
  schemaStructure?: SchemaStructureCollection[];
  prompt: string;
}) {
  const explicit = normalizeDataStores(datastores)
    ?? normalizeSchemaStructure(schemaStructure)
    ?? extractSchemaStructureFromPrompt(prompt);

  if (explicit && explicit.length > 0) {
    saveSchemaContext(ref, explicit);
    return explicit;
  }

  const saved = loadSchemaContext(ref);
  if (saved?.length) return saved;

  saveSchemaContext(ref, PRINCIPAL_SUPERVISOR_DATASTORES);
  return PRINCIPAL_SUPERVISOR_DATASTORES;
}

function normalizeDataStores(datastores?: DataStore[]) {
  if (!datastores?.length) return undefined;
  return datastores;
}

function normalizeSchemaStructure(schemaStructure?: SchemaStructureCollection[]) {
  if (!schemaStructure?.length) return undefined;
  return schemaStructure.map((collection, _, allCollections) => {
    const fields = collection.fields.map((field) => normalizeField(field));
    const joins = inferJoins(collection, allCollections);
    return {
      name: collection.name?.trim() || collection.collection,
      collection: collection.collection,
      ...(collection.description ? { description: collection.description } : {}),
      fields,
      ...(joins.length ? { joins } : {}),
    } satisfies DataStore;
  });
}

function normalizeField(field: SchemaStructureCollection['fields'][number]): DataStoreField {
  const description = field.description?.trim() || field.desc?.trim();
  return {
    name: field.name,
    type: normalizeFieldType(field.type),
    ...(description ? { description } : {}),
    ...(inferFieldRole(field.name, field.type) ? { role: inferFieldRole(field.name, field.type) } : {}),
    ...(inferReferenceTo(description) ? { referenceTo: inferReferenceTo(description) } : {}),
  };
}

function normalizeFieldType(type?: string): FieldType {
  switch ((type ?? 'string').toLowerCase()) {
    case 'string':
    case 'number':
    case 'integer':
    case 'boolean':
    case 'date':
    case 'datetime':
    case 'enum':
    case 'reference':
    case 'array':
    case 'object':
    case 'geo':
    case 'text':
      return type!.toLowerCase() as FieldType;
    default:
      return 'string';
  }
}

function inferFieldRole(name: string, type?: string): DataStoreField['role'] | undefined {
  const normalizedType = normalizeFieldType(type);
  if (normalizedType === 'date' || normalizedType === 'datetime') return 'temporal';
  if (normalizedType === 'text') return 'text';
  if (/id$/i.test(name)) return 'id';
  if (normalizedType === 'number' || normalizedType === 'integer') {
    return /^(value|count|total|sum|avg|average|amount|score|rate|quantity)$/i.test(name)
      ? 'measure'
      : undefined;
  }
  return 'dimension';
}

function inferReferenceTo(description?: string) {
  const text = description?.toLowerCase();
  if (!text) return undefined;
  const match = text.match(/([a-z_]+)\s+reference\s+id/);
  if (!match) return undefined;
  return `${pluralize(match[1])}.id`;
}

function inferJoins(
  collection: SchemaStructureCollection,
  allCollections: SchemaStructureCollection[],
): DataStoreJoin[] {
  const availableCollections = new Map(
    allCollections.map((item) => [normalizeToken(item.collection), item.collection] as const),
  );

  return collection.fields.flatMap((field) => {
    const description = field.description?.trim() || field.desc?.trim();
    const referenceTo = inferReferenceTo(description);
    if (!referenceTo) return [];
    const [toCollection] = referenceTo.split('.');
    const resolvedCollection = availableCollections.get(normalizeToken(toCollection));
    if (!resolvedCollection) return [];
    return [{
      from: resolvedCollection,
      localField: field.name,
      foreignField: 'id',
      as: resolvedCollection,
    }];
  });
}

function extractSchemaStructureFromPrompt(prompt: string) {
  const match = prompt.match(/\[[\s\S]*\]/);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[0]) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    const candidates = parsed.filter(isSchemaStructureCollection);
    if (candidates.length === 0) return undefined;
    return normalizeSchemaStructure(candidates);
  } catch {
    return undefined;
  }
}

function isSchemaStructureCollection(value: unknown): value is SchemaStructureCollection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.collection === 'string' && Array.isArray(record.fields);
}

function pluralize(value: string) {
  if (value.endsWith('ies')) return value;
  if (value.endsWith('y')) return `${value.slice(0, -1)}ies`;
  if (value.endsWith('s')) return value;
  return `${value}s`;
}

function normalizeToken(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function cacheKey(ref: ConversationRef) {
  return `${ref.resourceId}::${ref.threadId}`;
}
