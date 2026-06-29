import { getMongo } from './mongo.client.js';

interface UserKeyDoc {
  userId:    string;
  apiKey:    string;
  model?:    string;
  provider?: string;
  updatedAt: Date;
}

export interface UserSettings {
  apiKey:    string;
  model?:    string;
  provider?: string;
}

async function col() {
  const { db } = await getMongo();
  return db.collection<UserKeyDoc>('user_keys');
}

export async function saveUserKey(userId: string, settings: UserSettings): Promise<void> {
  const c = await col();
  await c.updateOne(
    { userId },
    { $set: { ...settings, updatedAt: new Date() } },
    { upsert: true },
  );
}

export async function getUserKey(userId: string): Promise<string | null> {
  const c = await col();
  const doc = await c.findOne({ userId });
  return doc?.apiKey ?? null;
}

export async function getUserSettings(userId: string): Promise<UserSettings | null> {
  const c = await col();
  const doc = await c.findOne({ userId });
  if (!doc) return null;
  return { apiKey: doc.apiKey, model: doc.model, provider: doc.provider };
}

export async function deleteUserKey(userId: string): Promise<void> {
  const c = await col();
  await c.deleteOne({ userId });
}
