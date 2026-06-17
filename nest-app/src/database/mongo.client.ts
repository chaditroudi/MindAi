import { MongoClient, Db } from 'mongodb';

let client: MongoClient | null = null;
let db: Db | null = null;

interface MongoConfig {
  uri: string | undefined;
  db: string | undefined;
  serverSelectionTimeoutMs: number;
  connectRetries: number;
}

export async function getMongo(configService?: MongoConfig): Promise<{ client: MongoClient; db: Db }> {
  if (client && db) return { client, db };

  const uri        = configService?.uri        ?? process.env['MONGODB_URI'] ?? process.env['DB_URL'];
  const dbName     = configService?.db         ?? process.env['MONGODB_DB'];
  const timeoutMs  = configService?.serverSelectionTimeoutMs ?? (Number(process.env['MONGODB_SERVER_SELECTION_TIMEOUT_MS']) || 8_000);
  const maxRetries = configService?.connectRetries            ?? (Number(process.env['MONGODB_CONNECT_RETRIES']) || 1);

  if (!uri)    throw new Error('MONGODB_URI or DB_URL is not set');
  if (!dbName) throw new Error('MONGODB_DB is not set');

  let lastError: unknown = new Error('MongoDB connection failed before any attempt completed.');

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const next = new MongoClient(uri, {
      ignoreUndefined:          true,
      serverSelectionTimeoutMS: timeoutMs,
      connectTimeoutMS:         timeoutMs,
    });
    try {
      await next.connect();
      client = next;
      db     = client.db(dbName);
      return { client, db };
    } catch (err) {
      lastError = err;
      await next.close().catch(() => undefined);
     
    }
  }

  const cause = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `MongoDB unreachable: "${dbName}" after ${maxRetries} attempt(s) (${timeoutMs}ms timeout). ` +
    `Verify MONGODB_URI and MONGODB_DB. Cause: ${cause}`,
  );
}

export async function closeMongo(): Promise<void> {
  if (!client) return;
  await client.close();
  client = null;
  db     = null;
}
