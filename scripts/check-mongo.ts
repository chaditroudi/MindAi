import 'dotenv/config';
import { closeMongo, getMongo } from '../src/db/mongo.client.js';

async function main() {
  const { db } = await getMongo();
  await db.admin().ping();
  console.log(`MongoDB reachable: ${db.databaseName}`);
}

main()
  .catch((err) => {
    console.error('MongoDB check failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongo().catch(() => undefined);
  });
