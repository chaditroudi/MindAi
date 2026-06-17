import { ObjectId, type WithId } from 'mongodb';
import { getMongo } from './mongo.client.js';
import { log } from '../utils/logger.js';

const COLLECTION = 'results_history';

export interface PipelineRunEntry {
  prompt:     string;
  intent:     string;
  collection: string;
  pipeline:   unknown[];
  rows:       Record<string, unknown>[];
  rowCount:   number;
  durationMs: number;
  createdAt?: Date;
}

class ResultsHistoryRepository {
  async save(entry: Omit<PipelineRunEntry, 'createdAt'>): Promise<string> {
    try {
      const { db } = await getMongo();
      const doc = { ...entry, createdAt: new Date() };
      const result = await db.collection(COLLECTION).insertOne(doc);
      return result.insertedId.toHexString();
    } catch (err) {
      log('history', `save failed: ${String(err)}`);
      return '';
    }
  }

  async list(filter: { intent?: string; skip?: number; limit?: number }): Promise<WithId<PipelineRunEntry>[]> {
    const { db } = await getMongo();
    const q = filter.intent ? { intent: filter.intent } : {};
    return db
      .collection<PipelineRunEntry>(COLLECTION)
      .find(q)
      .sort({ createdAt: -1 })
      .skip(filter.skip ?? 0)
      .limit(Math.min(filter.limit ?? 20, 100))
      .toArray();
  }

  async findById(id: string): Promise<WithId<PipelineRunEntry> | null> {
    if (!ObjectId.isValid(id)) return null;
    const { db } = await getMongo();
    return db.collection<PipelineRunEntry>(COLLECTION).findOne({ _id: new ObjectId(id) });
  }

  async count(filter: { intent?: string }): Promise<number> {
    const { db } = await getMongo();
    const q = filter.intent ? { intent: filter.intent } : {};
    return db.collection(COLLECTION).countDocuments(q);
  }

  async deleteById(id: string): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const { db } = await getMongo();
    const result = await db.collection(COLLECTION).deleteOne({ _id: new ObjectId(id) });
    return result.deletedCount === 1;
  }
}

export const histRepo = new ResultsHistoryRepository();
