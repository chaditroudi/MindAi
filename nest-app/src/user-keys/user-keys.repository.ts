import { getMongo } from '../database/mongo.client';

const COLLECTION = 'user_api_keys';

export async function saveUserKey(userId: string, apiKey: string): Promise<void> {
  const { db } = await getMongo();
  await db.collection(COLLECTION).updateOne(
    { userId },
    { $set: { apiKey, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true },
  );
}

export async function getUserKey(userId: string): Promise<string | null> {
  const { db } = await getMongo();
  const doc = await db.collection(COLLECTION).findOne({ userId }, { projection: { apiKey: 1 } });
  return typeof doc?.apiKey === 'string' ? doc.apiKey : null;
}

export async function deleteUserKey(userId: string): Promise<void> {
  const { db } = await getMongo();
  await db.collection(COLLECTION).deleteOne({ userId });
}
