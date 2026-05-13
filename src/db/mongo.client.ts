import { MongoClient, Db } from 'mongodb';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function getMongo(): Promise<{ client: MongoClient; db: Db }> {
  if (client && db) return { client, db };

  const uri = process.env.MONGODB_URI ?? process.env.DB_URL;
  const dbName = process.env.MONGODB_DB;
  const timeoutMs = Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS ?? 8000);
  const maxRetries = Number(process.env.MONGODB_CONNECT_RETRIES ?? 3);
  if (!uri) throw new Error('MONGODB_URI or DB_URL is not set');
  if (!dbName) throw new Error('MONGODB_DB is not set');

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const nextClient = new MongoClient(uri, {
      ignoreUndefined: true,
      serverSelectionTimeoutMS: timeoutMs,
      connectTimeoutMS: timeoutMs,
    });

    try {
      await nextClient.connect();
      client = nextClient;
      db = client.db(dbName);
      return { client, db };
    } catch (err) {
      lastError = err;
      await nextClient.close().catch(() => undefined);

      if (!isRetryableMongoConnectError(err) || attempt === maxRetries) {
        throw err;
      }

      const delayMs = Math.min(500 * attempt, 2000);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('MongoDB connection failed');
}

export async function closeMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

function isRetryableMongoConnectError(error: unknown) {
  const text =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : typeof error === 'string'
        ? error
        : JSON.stringify(error);

  return /server selection timed out|ENOTFOUND|ECONNRESET|ETIMEDOUT|PoolClearedOnNetworkError|MongoNetwork/i.test(
    text,
  );
}
