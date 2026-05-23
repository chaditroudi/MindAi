import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { BSON } from 'mongodb';
import { getMongo, closeMongo } from '../src/db/mongo.client.js';
import { generateSampleCollections } from '../src/mock/sample-data.js';
import type { DataStore } from '../src/types/index.js';

const TENANT_ID = 't_mind_qatar';

async function main() {
  console.log('Seeding Mind Platform review data…');
  try {
    const { db } = await getMongo();
    const collections = generateSampleCollections(TENANT_ID);

    const dataStorePath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../samples/datastore.json',
    );
    const dataStores = BSON.EJSON.parse(readFileSync(dataStorePath, 'utf-8')) as DataStore[];

    await db.collection('data_stores').deleteMany({});
    await db.collection('data_stores').insertMany(dataStores);
    console.log(`  ✓ ${dataStores.length} data stores`);

    const serviceRequests = collections.service_requests;
    await db.collection('service_requests').deleteMany({});
    await db.collection('service_requests').insertMany(serviceRequests);
    console.log(`  ✓ ${serviceRequests.length} service requests`);

    const inspections = collections.inspections;
    await db.collection('inspections').deleteMany({});
    await db.collection('inspections').insertMany(inspections);
    console.log(`  ✓ ${inspections.length} inspections`);

    const permits = collections.permits;
    await db.collection('permits').deleteMany({});
    await db.collection('permits').insertMany(permits);
    console.log(`  ✓ ${permits.length} permits`);

    const projects = collections.projects;
    await db.collection('projects').deleteMany({});
    await db.collection('projects').insertMany(projects);
    console.log(`  ✓ ${projects.length} projects`);

    const indexSpecs: Array<[string, Record<string, 1 | -1>]> = [
      ['service_requests', { tenantId: 1, municipality: 1 }],
      ['service_requests', { tenantId: 1, serviceType: 1 }],
      ['service_requests', { tenantId: 1, status: 1, createdAt: -1 }],
      ['inspections', { tenantId: 1, municipality: 1, createdAt: -1 }],
      ['inspections', { tenantId: 1, outcome: 1 }],
      ['permits', { tenantId: 1, municipality: 1, createdAt: -1 }],
      ['permits', { tenantId: 1, permitType: 1 }],
      ['permits', { tenantId: 1, status: 1 }],
      ['projects', { tenantId: 1, municipality: 1 }],
      ['projects', { tenantId: 1, stage: 1 }],
      ['projects', { tenantId: 1, createdAt: -1 }],
    ];

    let indexWarnings = 0;
    for (const [collectionName, spec] of indexSpecs) {
      try {
        await db.collection(collectionName).createIndex(spec);
      } catch (err) {
        indexWarnings += 1;
        console.warn(
          `  ! Skipped index on ${collectionName} ${JSON.stringify(spec)}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    console.log(indexWarnings === 0 ? '  ✓ indexes' : `  ! indexes completed with ${indexWarnings} warning(s)`);
    console.log('Done. Sample tenantId is "t_mind_qatar".');
  } finally {
    await closeMongo().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
