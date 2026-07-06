import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI ?? process.env.DB_URL;
const dbName = process.env.MONGODB_DB;

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);

const entries = await db.collection('prompt_cache')
  .find({ prompt: /show total budget by region/i })
  .toArray();
console.log('matching entries:', entries.length);
console.log(JSON.stringify(entries, null, 2));

await client.close();
