import { getMongo } from './mongo.client.js';

interface UserKeyDoc {
  userId: string;
  apiKey: string;
  updatedAt: Date;
}

async function col() {
  const { db } = await getMongo();
  return db.collection<UserKeyDoc>('user_keys');
}

export async function saveUserKey(userId: string, apiKey: string): Promise<void> {
  const c = await col();
  await c.updateOne(
    { userId },
    { $set: { apiKey, updatedAt: new Date() } },
    { upsert: true },
  );
}

export async function getUserKey(userId: string): Promise<string | null> {
  const c = await col();
  const doc = await c.findOne({ userId });
  return doc?.apiKey ?? null;
}

export async function deleteUserKey(userId: string): Promise<void> {
  const c = await col();
  await c.deleteOne({ userId });
}
