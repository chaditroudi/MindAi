import { ObjectId } from 'mongodb';
import { getMongo } from './mongo.client.js';

const COLLECTION = 'saved_results';

export interface SavedResultDoc {
  _id?:      ObjectId;
  userId:    string;
  title:     string;
  prompt:    string;
  intent:    'dashboard' | 'report' | 'inquiry';
  result:    unknown;
  createdAt: Date;
}

export interface SavedResultSummary {
  id:        string;
  title:     string;
  prompt:    string;
  intent:    'dashboard' | 'report' | 'inquiry';
  createdAt: string;
}

export interface SavedResultDetail extends SavedResultSummary {
  result: unknown;
}

export async function saveResult(doc: Omit<SavedResultDoc, '_id' | 'createdAt'>): Promise<string> {
  const { db } = await getMongo();
  const { insertedId } = await db.collection(COLLECTION).insertOne({
    ...doc,
    createdAt: new Date(),
  });
  return insertedId.toHexString();
}

export async function listResults(userId: string): Promise<SavedResultSummary[]> {
  const { db } = await getMongo();
  const docs = await db.collection(COLLECTION)
    .find({ userId }, { projection: { result: 0 } })
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();
  return docs.map(d => ({
    id:        (d._id as ObjectId).toHexString(),
    title:     d.title as string,
    prompt:    d.prompt as string,
    intent:    d.intent as SavedResultSummary['intent'],
    createdAt: (d.createdAt as Date).toISOString(),
  }));
}

export async function getResult(id: string, userId: string): Promise<SavedResultDetail | null> {
  const { db } = await getMongo();
  let oid: ObjectId;
  try { oid = new ObjectId(id); } catch { return null; }
  const doc = await db.collection(COLLECTION).findOne({ _id: oid, userId });
  if (!doc) return null;
  return {
    id:        (doc._id as ObjectId).toHexString(),
    title:     doc.title as string,
    prompt:    doc.prompt as string,
    intent:    doc.intent as SavedResultSummary['intent'],
    result:    doc.result,
    createdAt: (doc.createdAt as Date).toISOString(),
  };
}

export async function deleteResult(id: string, userId: string): Promise<boolean> {
  const { db } = await getMongo();
  let oid: ObjectId;
  try { oid = new ObjectId(id); } catch { return false; }
  const { deletedCount } = await db.collection(COLLECTION).deleteOne({ _id: oid, userId });
  return deletedCount > 0;
}
