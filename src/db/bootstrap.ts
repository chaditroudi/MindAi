import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BSON } from 'mongodb';
import { getMongo } from './mongo.client.js';

const DEFAULT_COLLECTIONS = ['municipalities', 'projects'];
const DEFAULT_TENANT_ID = process.env.BOOTSTRAP_TENANT_ID ?? 't_mind_qatar';
const BOOTSTRAP_ENABLED = !['false', '0', 'no'].includes((process.env.MONGODB_AUTO_BOOTSTRAP ?? 'true').toLowerCase());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..');

let bootstrapPromise: Promise<void> | null = null;

export async function ensureMongoBootstrap() {
  if (!BOOTSTRAP_ENABLED) return;
  if (!bootstrapPromise) {
    bootstrapPromise = bootstrapMongo().catch((error) => {
      bootstrapPromise = null;
      throw error;
    });
  }
  await bootstrapPromise;
}

async function bootstrapMongo() {
  const { db } = await getMongo();
  const existingDataStores = await db.collection('data_stores').countDocuments({}, { limit: 1 });
  if (existingDataStores > 0) return;

  const dataStores = await readJsonArray(path.join(rootDir, 'dataset', 'datastores.json'));
  const collections = await Promise.all(
    DEFAULT_COLLECTIONS.map(async (collectionName) => ({
      collectionName,
      docs: await readJsonArray(path.join(rootDir, 'dataset', `${collectionName}.json`)),
    })),
  );

  await db.collection('data_stores').deleteMany({});
  if (dataStores.length > 0) {
    await db.collection('data_stores').insertMany(dataStores, { ordered: false });
  }

  for (const { collectionName, docs } of collections) {
    const filteredDocs = filterByTenant(docs, DEFAULT_TENANT_ID);
    await db.collection(collectionName).deleteMany({});
    if (filteredDocs.length > 0) {
      await db.collection(collectionName).insertMany(filteredDocs, { ordered: false });
    }
  }

  console.log(`MongoDB bootstrap completed for database "${db.databaseName}".`);
}

async function readJsonArray(filePath: string): Promise<Record<string, unknown>[]> {
  try {
    const source = await readFile(filePath, 'utf8');
    const parsed = BSON.EJSON.parse(source, { relaxed: false }) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error(`${path.basename(filePath)} must contain a top-level JSON array.`);
    }
    return parsed as Record<string, unknown>[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

function filterByTenant(records: Record<string, unknown>[], tenantId: string) {
  const hasTenantField = records.some((record) => Object.hasOwn(record, 'tenantId'));
  if (!hasTenantField) return records;
  return records.filter((record) => record.tenantId === tenantId);
}
