import { ObjectId } from 'mongodb';
import { getMongo } from './mongo.client.js';
import type { IntentKind, DataStore } from '../types/index.js';

const COLLECTION = 'results_history';

export interface HistoryEntry {
  _id?: ObjectId;
  tenantId: string;
  userId: string;
  intent: IntentKind | 'search';
  prompt: string;
  datastores?: DataStore[];
  pipeline?: Record<string, unknown>[];
  result: {
    summary?: string;
    chart?: Record<string, unknown>;
    reportSections?: { heading: string; body: string }[];
    recordLinks?: { collection: string; id: string; label: string }[];
    searchTerms?: string[];
    rows?: Record<string, unknown>[];
  };
  durationMs: number;
  createdAt: Date;
}

export interface HistoryFilter {
  tenantId: string;
  intent?: IntentKind | 'search';
  limit?: number;
  skip?: number;
}

class ResultsHistoryRepository {
  async save(entry: Omit<HistoryEntry, '_id' | 'createdAt'>): Promise<string> {
    try {
      const { db } = await getMongo();
      const doc: HistoryEntry = { ...entry, createdAt: new Date() };
      const result = await db.collection<HistoryEntry>(COLLECTION).insertOne(doc);
      return result.insertedId.toHexString();
    } catch {
      return '';
    }
  }

  async list(filter: HistoryFilter): Promise<HistoryEntry[]> {
    const { db } = await getMongo();
    const query: Record<string, unknown> = { tenantId: filter.tenantId };
    if (filter.intent) query.intent = filter.intent;

    return db
      .collection<HistoryEntry>(COLLECTION)
      .find(query)
      .sort({ createdAt: -1 })
      .skip(filter.skip ?? 0)
      .limit(Math.min(filter.limit ?? 20, 100))
      .toArray();
  }

  async findById(id: string, tenantId: string): Promise<HistoryEntry | null> {
    if (!ObjectId.isValid(id)) return null;
    const { db } = await getMongo();
    return db
      .collection<HistoryEntry>(COLLECTION)
      .findOne({ _id: new ObjectId(id), tenantId });
  }

  async count(filter: Pick<HistoryFilter, 'tenantId' | 'intent'>): Promise<number> {
    const { db } = await getMongo();
    const query: Record<string, unknown> = { tenantId: filter.tenantId };
    if (filter.intent) query.intent = filter.intent;
    return db.collection<HistoryEntry>(COLLECTION).countDocuments(query);
  }

  async deleteById(id: string, tenantId: string): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const { db } = await getMongo();
    const result = await db
      .collection<HistoryEntry>(COLLECTION)
      .deleteOne({ _id: new ObjectId(id), tenantId });
    return result.deletedCount === 1;
  }
}

export const historyRepo = new ResultsHistoryRepository();
