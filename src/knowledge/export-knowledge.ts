import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMongo } from '../db/mongo.client.js';
import { log } from '../observability/log.js';
import type { Citation, Dataset, FieldType } from '../types/index.js';

const EXCLUDED_COLLECTIONS = new Set(['otp', 'users_auth']);
const DEFAULT_OPENROUTER_EMBEDDING_MODEL = 'openai/text-embedding-3-small';
const DEFAULT_KNOWLEDGE_COLLECTION = 'knowledge_chunks';
const DEFAULT_SHARED_KNOWLEDGE_TENANT = '_shared';
const EMBEDDING_BATCH_SIZE = 16;

const CATEGORY_KEYWORDS: Array<{ category: string; collections: string[] }> = [
  {
    category: 'analytics',
    collections: ['service_requests', 'inspections', 'permits', 'projects', 'activities'],
  },
  {
    category: 'configuration',
    collections: ['_blueprints', 'blueprints', 'data_stores', 'platforms', 'platforms_stats', 'system_settings'],
  },
  {
    category: 'workspace',
    collections: [
      'workspaces',
      'groups',
      'memberships',
      'users',
      'topics',
      'comments',
      'tasks',
      'assets',
      'dashboards',
      'reports',
    ],
  },
  { category: 'audit', collections: ['sys_logs', 'entities_act_stats'] },
];

interface KnowledgeFieldSummary {
  name: string;
  type: FieldType;
  sampleValues: string[];
  sensitive: boolean;
}

interface CollectionKnowledgeDoc {
  id: string;
  collection: string;
  title: string;
  category: string;
  rowCount: number;
  analyticsReady: boolean;
  fieldNames: string[];
  fields: KnowledgeFieldSummary[];
  text: string;
}

interface KnowledgeChunk {
  chunkId: string;
  collection: string;
  title: string;
  category: string;
  rowCount: number;
  analyticsReady: boolean;
  fieldNames: string[];
  text: string;
  kind: 'overview' | 'fields';
  contentHash: string;
}

interface StoredKnowledgeChunk extends KnowledgeChunk {
  tenantId: string;
  embeddingModel: string;
  embedding: number[];
  updatedAt: Date;
}

export interface KnowledgeSearchHit {
  id: string;
  title: string;
  collection: string;
  category: string;
  rowCount: number;
  analyticsReady: boolean;
  text: string;
  fieldNames: string[];
  score: number;
}

let knowledgeCache: CollectionKnowledgeDoc[] | null = null;
let knowledgeChunkCache: KnowledgeChunk[] | null = null;

export function searchExportKnowledge(query: string, topK = 5): KnowledgeSearchHit[] {
  const corpus = loadExportKnowledge();
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  return corpus
    .map((doc) => {
      const haystack = normalizeText(
        [doc.collection, doc.title, doc.category, doc.text, ...doc.fieldNames].join(' '),
      );
      let score = 0;

      const joinedQuery = normalizeText(query);
      if (joinedQuery && haystack.includes(joinedQuery)) score += 24;

      for (const token of tokens) {
        if (doc.collection.includes(token)) score += 10;
        if (doc.category.includes(token)) score += 6;
        if (doc.fieldNames.some((field) => normalizeText(field).includes(token))) score += 5;
        if (haystack.includes(token)) score += 2;
      }

      if (doc.analyticsReady) score += 1;

      return {
        id: doc.id,
        title: doc.title,
        collection: doc.collection,
        category: doc.category,
        rowCount: doc.rowCount,
        analyticsReady: doc.analyticsReady,
        text: doc.text,
        fieldNames: doc.fieldNames,
        score,
      };
    })
    .filter((doc) => doc.score > 0)
    .sort((a, b) => b.score - a.score || b.rowCount - a.rowCount)
    .slice(0, topK);
}

export async function semanticSearchExportKnowledge(query: string, topK = 5, tenantId?: string): Promise<KnowledgeSearchHit[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  const docs = await loadStoredKnowledgeChunks(tenantId);
  if (docs.length === 0) {
    throw new Error(
      `Knowledge index is empty for tenant "${tenantId ?? resolveKnowledgeTenantId()}". Run "npm run knowledge:index" before using internal RAG.`,
    );
  }

  const [queryVector] = await embedTexts([trimmedQuery]);
  const queryTokens = tokenize(trimmedQuery);

  return docs
    .map((doc) => {
      const semanticScore = cosineSimilarity(queryVector, doc.embedding);
      const lexicalBoost = computeChunkLexicalBoost(trimmedQuery, queryTokens, doc);
      return {
        id: doc.chunkId,
        title: doc.title,
        collection: doc.collection,
        category: doc.category,
        rowCount: doc.rowCount,
        analyticsReady: doc.analyticsReady,
        text: doc.text,
        fieldNames: doc.fieldNames,
        score: semanticScore + lexicalBoost,
      };
    })
    .sort((a, b) => b.score - a.score || b.rowCount - a.rowCount)
    .slice(0, topK);
}

export async function indexKnowledgeInMongo() {
  const chunks = loadKnowledgeChunks();
  const tenantId = resolveKnowledgeTenantId();
  const embeddingModel = resolveEmbeddingModel();
  const embeddings = await embedTexts(chunks.map((chunk) => chunk.text));
  const collectionName = resolveKnowledgeCollectionName();
  const { db } = await getMongo();
  const collection = db.collection<StoredKnowledgeChunk>(collectionName);

  await collection.createIndex({ tenantId: 1, chunkId: 1 }, { unique: true });
  await collection.createIndex({ tenantId: 1, collection: 1 });

  if (chunks.length > 0) {
    await collection.bulkWrite(
      chunks.map((chunk, index) => ({
        updateOne: {
          filter: { tenantId, chunkId: chunk.chunkId },
          update: {
            $set: {
              tenantId,
              chunkId: chunk.chunkId,
              collection: chunk.collection,
              title: chunk.title,
              category: chunk.category,
              rowCount: chunk.rowCount,
              analyticsReady: chunk.analyticsReady,
              fieldNames: chunk.fieldNames,
              text: chunk.text,
              kind: chunk.kind,
              contentHash: chunk.contentHash,
              embeddingModel,
              embedding: embeddings[index],
              updatedAt: new Date(),
            },
          },
          upsert: true,
        },
      })),
    );
  }

  const chunkIds = chunks.map((chunk) => chunk.chunkId);
  await collection.deleteMany({
    tenantId,
    ...(chunkIds.length > 0 ? { chunkId: { $nin: chunkIds } } : {}),
  });

  log.info('knowledge.indexed', {
    tenantId,
    chunkCount: chunks.length,
    embeddingModel,
    collection: collectionName,
  });

  return {
    tenantId,
    chunkCount: chunks.length,
    embeddingModel,
    collectionName,
  };
}

export function getKnowledgePromptContext(prompt: string, limit = 4) {
  return {
    collections: searchExportKnowledge(prompt, limit).map((hit) => ({
      collection: hit.collection,
      category: hit.category,
      rowCount: hit.rowCount,
      analyticsReady: hit.analyticsReady,
      fields: hit.fieldNames.slice(0, 10),
      summary: hit.text.slice(0, 700),
    })),
  };
}

export function buildKnowledgeDataset(query: string, topK = 5): Dataset {
  const hits = searchExportKnowledge(query, topK);
  const rows = hits.map((hit, index) => ({
    id: hit.id,
    title: hit.title,
    collection: hit.collection,
    category: hit.category,
    rowCount: hit.rowCount,
    analyticsReady: hit.analyticsReady,
    summary: hit.text.slice(0, 500),
    rank: index + 1,
  }));

  const citations: Citation[] = hits.map((hit) => ({
    title: hit.title,
    snippet: hit.text.slice(0, 220),
  }));

  return {
    rows,
    schema: {
      id: 'string',
      title: 'string',
      collection: 'string',
      category: 'string',
      rowCount: 'number',
      analyticsReady: 'boolean',
      summary: 'string',
      rank: 'number',
    },
    source: 'search',
    citations,
  };
}

function loadExportKnowledge(): CollectionKnowledgeDoc[] {
  if (knowledgeCache) return knowledgeCache;

  const exportDir = resolveExportDirectory();
  if (!exportDir || !existsSync(exportDir)) {
    knowledgeCache = [];
    return knowledgeCache;
  }

  const docs: CollectionKnowledgeDoc[] = [];
  for (const filename of readdirSync(exportDir)) {
    if (!filename.endsWith('.json')) continue;

    const collection = filename.replace(/\.json$/i, '');
    if (EXCLUDED_COLLECTIONS.has(collection)) continue;

    const fullPath = resolve(exportDir, filename);
    const raw = safeParseJson(readFileSync(fullPath, 'utf-8'));
    if (!Array.isArray(raw)) continue;

    const normalizedRows = raw.slice(0, 25).map((row) => normalizeBsonValue(row));
    const fields = summarizeFields(normalizedRows);
    const category = inferCategory(collection);
    const analyticsReady = inferAnalyticsReady(collection, fields);
    const text = buildKnowledgeText({
      collection,
      rowCount: raw.length,
      category,
      analyticsReady,
      fields,
    });

    docs.push({
      id: `export:${collection}`,
      collection,
      title: humanizeCollectionName(collection),
      category,
      rowCount: raw.length,
      analyticsReady,
      fieldNames: fields.map((field) => field.name),
      fields,
      text,
    });
  }

  knowledgeCache = docs.sort((a, b) => b.rowCount - a.rowCount || a.collection.localeCompare(b.collection));
  return knowledgeCache;
}

function loadKnowledgeChunks() {
  if (knowledgeChunkCache) return knowledgeChunkCache;

  const chunks: KnowledgeChunk[] = [];
  for (const doc of loadExportKnowledge()) {
    chunks.push(createKnowledgeChunk({
      chunkId: `${doc.id}:overview`,
      collection: doc.collection,
      title: `${doc.title} Overview`,
      category: doc.category,
      rowCount: doc.rowCount,
      analyticsReady: doc.analyticsReady,
      fieldNames: doc.fieldNames,
      text: doc.text,
      kind: 'overview',
    }));

    for (const [index, fieldGroup] of chunkArray(doc.fields, 6).entries()) {
      const fieldText = fieldGroup
        .map((field) => {
          const examples =
            field.sampleValues.length > 0 ? ` Example values: ${field.sampleValues.join(', ')}.` : '';
          const sensitivity = field.sensitive ? ' Sensitive field.' : '';
          return `${field.name} (${field.type}).${examples}${sensitivity}`;
        })
        .join(' ');

      chunks.push(
        createKnowledgeChunk({
          chunkId: `${doc.id}:fields:${index + 1}`,
          collection: doc.collection,
          title: `${doc.title} Fields ${index + 1}`,
          category: doc.category,
          rowCount: doc.rowCount,
          analyticsReady: doc.analyticsReady,
          fieldNames: fieldGroup.map((field) => field.name),
          text: [
            `Collection ${doc.collection}.`,
            `Category: ${doc.category}.`,
            `Field group ${index + 1}.`,
            `This collection has about ${doc.rowCount} exported rows.`,
            fieldText,
          ].join(' '),
          kind: 'fields',
        }),
      );
    }
  }

  knowledgeChunkCache = chunks;
  return knowledgeChunkCache;
}

async function loadStoredKnowledgeChunks(tenantId?: string) {
  const sharedTenantId = resolveSharedKnowledgeTenantId();
  const targetTenantId = tenantId?.trim();
  const { db } = await getMongo();
  const collection = db.collection<StoredKnowledgeChunk>(resolveKnowledgeCollectionName());
  const allowedTenantIds = targetTenantId && targetTenantId !== sharedTenantId
    ? [targetTenantId, sharedTenantId]
    : [sharedTenantId];

  return collection
    .find({
      tenantId: { $in: allowedTenantIds },
    })
    .toArray();
}

function createKnowledgeChunk(chunk: Omit<KnowledgeChunk, 'contentHash'>): KnowledgeChunk {
  return {
    ...chunk,
    contentHash: createHash('sha1').update(chunk.text).digest('hex'),
  };
}

function resolveExportDirectory() {
  const cwdPath = resolve(process.cwd(), 'samples', 'db-export');
  if (existsSync(cwdPath)) return cwdPath;

  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const localPath = resolve(moduleDir, '../../samples/db-export');
  if (existsSync(localPath)) return localPath;

  return null;
}

function resolveKnowledgeCollectionName() {
  return process.env.KNOWLEDGE_COLLECTION?.trim() || DEFAULT_KNOWLEDGE_COLLECTION;
}

function resolveKnowledgeTenantId() {
  return process.env.KNOWLEDGE_TENANT_ID?.trim() || resolveSharedKnowledgeTenantId();
}

function resolveSharedKnowledgeTenantId() {
  return process.env.KNOWLEDGE_SHARED_TENANT_ID?.trim() || DEFAULT_SHARED_KNOWLEDGE_TENANT;
}

function resolveEmbeddingModel() {
  return process.env.OPENROUTER_EMBEDDING_MODEL?.trim() || DEFAULT_OPENROUTER_EMBEDDING_MODEL;
}

async function embedTexts(texts: string[]) {
  if (texts.length === 0) return [];

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is required for knowledge embeddings.');
  }

  const embeddingModel = resolveEmbeddingModel();
  const referer = process.env.OPENROUTER_SITE_URL?.trim();
  const title = process.env.OPENROUTER_APP_NAME?.trim();
  const dimensions = parsePositiveInteger(process.env.OPENROUTER_EMBEDDING_DIMENSIONS);
  const result: number[][] = [];

  for (let index = 0; index < texts.length; index += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(index, index + EMBEDDING_BATCH_SIZE);
    const body: Record<string, unknown> = {
      model: embeddingModel,
      input: batch,
      encoding_format: 'float',
    };
    if (dimensions) {
      body.dimensions = dimensions;
    }

    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(referer ? { 'HTTP-Referer': referer } : {}),
        ...(title ? { 'X-OpenRouter-Title': title } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await safeReadText(response);
      throw new Error(`OpenRouter embeddings failed: ${response.status} ${response.statusText} ${errorText}`);
    }

    const payload = (await response.json()) as {
      data?: Array<{
        embedding?: number[];
      }>;
    };

    const embeddings = payload.data?.map((entry) => entry.embedding).filter(isNumberArray) ?? [];
    if (embeddings.length !== batch.length) {
      throw new Error(
        `OpenRouter embeddings returned ${embeddings.length} vectors for a batch of ${batch.length}.`,
      );
    }

    result.push(...embeddings);
  }

  return result;
}

function summarizeFields(rows: unknown[]): KnowledgeFieldSummary[] {
  const fieldMap = new Map<string, { values: unknown[]; sensitive: boolean }>();

  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    for (const [name, value] of Object.entries(row as Record<string, unknown>)) {
      if (!fieldMap.has(name)) {
        fieldMap.set(name, { values: [], sensitive: isSensitiveField(name, value) });
      }
      const entry = fieldMap.get(name)!;
      if (entry.values.length < 12) entry.values.push(value);
      entry.sensitive = entry.sensitive || isSensitiveField(name, value);
    }
  }

  return [...fieldMap.entries()]
    .map(([name, info]) => ({
      name,
      type: inferFieldType(info.values),
      sampleValues: info.sensitive ? [] : collectSampleValues(info.values),
      sensitive: info.sensitive,
    }))
    .sort((a, b) => fieldRank(a.name) - fieldRank(b.name) || a.name.localeCompare(b.name));
}

function buildKnowledgeText({
  collection,
  rowCount,
  category,
  analyticsReady,
  fields,
}: {
  collection: string;
  rowCount: number;
  category: string;
  analyticsReady: boolean;
  fields: KnowledgeFieldSummary[];
}) {
  const renderedFields = fields
    .slice(0, 14)
    .map((field) => {
      const examples = field.sampleValues.length > 0 ? ` Examples: ${field.sampleValues.join(', ')}.` : '';
      const sensitivity = field.sensitive ? ' Sensitive field; examples omitted.' : '';
      return `${field.name} (${field.type}).${examples}${sensitivity}`;
    })
    .join(' ');

  return [
    `Collection ${collection}.`,
    `Category: ${category}.`,
    `Approximate exported row count: ${rowCount}.`,
    analyticsReady
      ? 'This collection looks suitable for descriptive analytics or summaries.'
      : 'This collection is better suited for reference or configuration context than charting.',
    `Known fields: ${renderedFields}`,
  ].join(' ');
}

function inferCategory(collection: string) {
  for (const entry of CATEGORY_KEYWORDS) {
    if (entry.collections.includes(collection)) return entry.category;
  }
  return 'reference';
}

function inferAnalyticsReady(collection: string, fields: KnowledgeFieldSummary[]) {
  if (CATEGORY_KEYWORDS.find((entry) => entry.category === 'analytics')?.collections.includes(collection)) {
    return true;
  }

  const hasTemporal = fields.some((field) => field.type === 'date' || field.type === 'datetime');
  const hasDimension = fields.some((field) => field.type === 'string' || field.type === 'enum');
  const hasMetric = fields.some((field) => field.type === 'number' || field.type === 'integer');
  return hasTemporal && hasDimension && hasMetric;
}

function collectSampleValues(values: unknown[]) {
  const result = new Set<string>();
  for (const value of values) {
    if (result.size >= 4) break;
    const rendered = renderPrimitive(value);
    if (rendered) result.add(rendered);
  }
  return [...result];
}

function renderPrimitive(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed.length > 48 ? `${trimmed.slice(0, 45)}...` : trimmed;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function inferFieldType(values: unknown[]): FieldType {
  const firstValue = values.find((value) => value !== null && value !== undefined);
  if (typeof firstValue === 'boolean') return 'boolean';
  if (typeof firstValue === 'number') return Number.isInteger(firstValue) ? 'integer' : 'number';
  if (Array.isArray(firstValue)) return 'array';
  if (firstValue && typeof firstValue === 'object') return 'object';
  if (typeof firstValue === 'string') {
    return looksLikeDate(firstValue) ? 'datetime' : 'string';
  }
  return 'string';
}

function normalizeBsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeBsonValue(item));
  if (!value || typeof value !== 'object') return value;

  const record = value as Record<string, unknown>;
  if ('$date' in record) return String(record.$date);
  if ('$oid' in record) return String(record.$oid);
  if ('$numberLong' in record) return Number(record.$numberLong);

  return Object.fromEntries(Object.entries(record).map(([key, nested]) => [key, normalizeBsonValue(nested)]));
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function tokenize(text: string) {
  return normalizeText(text)
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function normalizeText(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function humanizeCollectionName(collection: string) {
  return collection
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function fieldRank(name: string) {
  if (name === '_id' || name === 'id') return 0;
  if (name === 'tenantId') return 1;
  if (name === 'createdAt') return 2;
  return 10;
}

function looksLikeDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}t/i.test(value) || /^\d{4}-\d{2}-\d{2}$/i.test(value);
}

function isSensitiveField(name: string, value: unknown) {
  if (/(password|secret|token|otp|auth|email|phone|mobile|hash|code)/i.test(name)) {
    return true;
  }
  if (typeof value === 'string' && /@/.test(value) && /\./.test(value)) {
    return true;
  }
  return false;
}

function cosineSimilarity(left: number[], right: number[]) {
  if (left.length === 0 || left.length !== right.length) return 0;

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }

  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function computeChunkLexicalBoost(query: string, tokens: string[], chunk: KnowledgeChunk | StoredKnowledgeChunk) {
  const haystack = normalizeText([chunk.collection, chunk.title, chunk.category, chunk.text].join(' '));
  let score = 0;

  const joinedQuery = normalizeText(query);
  if (joinedQuery && haystack.includes(joinedQuery)) score += 0.08;
  if (chunk.kind === 'overview') score += 0.02;
  if (chunk.analyticsReady) score += 0.01;

  for (const token of tokens) {
    if (normalizeText(chunk.collection).includes(token)) score += 0.04;
    if (chunk.fieldNames.some((field) => normalizeText(field).includes(token))) score += 0.03;
    if (haystack.includes(token)) score += 0.01;
  }

  return score;
}

function parsePositiveInteger(value: string | undefined) {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('OPENROUTER_EMBEDDING_DIMENSIONS must be a positive integer when set.');
  }
  return parsed;
}

async function safeReadText(response: Response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'number');
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
