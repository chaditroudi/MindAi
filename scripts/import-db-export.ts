import 'dotenv/config';
import { readFileSync, existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BSON, type Document } from 'mongodb';
import { closeMongo, getMongo } from '../src/db/mongo.client.js';
import type { DataStore } from '../src/types/index.js';

const DEFAULT_TENANT_ID = 't_mind_qatar';
const DEFAULT_COLLECTIONS = ['service_requests', 'inspections', 'permits', 'projects'];
const SAFE_COLLECTIONS = new Set([
  'service_requests',
  'inspections',
  'permits',
  'projects',
  'activities',
  'assets',
  'comments',
  'dashboards',
  'reports',
  'tasks',
  'topics',
  'workspaces',
]);

async function main() {
  const tenantId = process.env.IMPORT_TENANT_ID ?? DEFAULT_TENANT_ID;
  const mode = process.env.IMPORT_MODE ?? 'replace';
  const importDataStores = process.env.IMPORT_DATA_STORES !== 'false';
  const selected = parseCollectionList(process.env.IMPORT_COLLECTIONS);
  const collections = selected.length > 0 ? selected : DEFAULT_COLLECTIONS;

  if (mode !== 'replace' && mode !== 'append') {
    throw new Error('IMPORT_MODE must be "replace" or "append".');
  }

  const exportDir = resolve(dirname(fileURLToPath(import.meta.url)), '../samples/db-export');
  const dataStorePath = resolve(dirname(fileURLToPath(import.meta.url)), '../samples/datastore.json');
  const { db } = await getMongo();

  console.log(`Importing db-export collections into MongoDB (${mode}, tenantId=${tenantId})`);

  if (importDataStores) {
    const dataStores = readDataStoreFile(dataStorePath);
    await db.collection('data_stores').deleteMany({});
    if (dataStores.length > 0) {
      await db.collection('data_stores').insertMany(dataStores, { ordered: false });
    }
    await db.collection('data_stores').createIndex({ name: 1 }, { unique: true }).catch(() => undefined);
    await db.collection('data_stores').createIndex({ collection: 1 }).catch(() => undefined);
    console.log(`  ✓ data_stores: ${dataStores.length} data store(s)`);
  }

  for (const collection of collections) {
    if (!SAFE_COLLECTIONS.has(collection)) {
      throw new Error(
        `Refusing to import unsafe collection "${collection}". Add it to SAFE_COLLECTIONS if it is intentional.`,
      );
    }

    const filePath = resolve(exportDir, `${collection}.json`);
    if (!existsSync(filePath)) {
      throw new Error(`Export file not found: ${filePath}`);
    }

    const docs = readExportFile(filePath).map((doc) => normalizeDocument(doc, tenantId));
    if (mode === 'replace') {
      await db.collection(collection).deleteMany({});
    }
    if (docs.length > 0) {
      await db.collection(collection).insertMany(docs, { ordered: false });
    }
    await ensureCommonIndexes(collection);
    console.log(`  ✓ ${collection}: ${docs.length} document(s)`);
  }

  console.log('Done.');
}

function parseCollectionList(raw: string | undefined) {
  return (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => basename(value, '.json'));
}

function readExportFile(filePath: string): Document[] {
  const parsed = BSON.EJSON.parse(readFileSync(filePath, 'utf-8'), { relaxed: true }) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected ${filePath} to contain a JSON array.`);
  }
  return parsed.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Expected every item in ${filePath} to be an object.`);
    }
    return value as Document;
  });
}

function readDataStoreFile(filePath: string): DataStore[] {
  const parsed = BSON.EJSON.parse(readFileSync(filePath, 'utf-8'), { relaxed: true }) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected ${filePath} to contain a JSON array.`);
  }
  return parsed.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Expected every item in ${filePath} to be an object.`);
    }
    return value as DataStore;
  });
}

function normalizeDocument(doc: Document, tenantId: string): Document {
  return {
    ...doc,
    tenantId: typeof doc.tenantId === 'string' && doc.tenantId.trim() ? doc.tenantId : tenantId,
  };
}

async function ensureCommonIndexes(collection: string) {
  const { db } = await getMongo();
  const coll = db.collection(collection);
  await coll.createIndex({ tenantId: 1 }).catch(() => undefined);

  if (['service_requests', 'inspections', 'permits', 'projects'].includes(collection)) {
    await coll.createIndex({ tenantId: 1, municipality: 1 }).catch(() => undefined);
    await coll.createIndex({ tenantId: 1, createdAt: -1 }).catch(() => undefined);
  }

  if (collection === 'service_requests' || collection === 'permits') {
    await coll.createIndex({ tenantId: 1, status: 1 }).catch(() => undefined);
  }

  if (collection === 'projects') {
    await coll.createIndex({ tenantId: 1, stage: 1 }).catch(() => undefined);
  }
}

main()
  .catch((err) => {
    console.error('Import failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongo().catch(() => undefined);
  });
