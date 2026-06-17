import { getMongo } from './mongo.client.js';
import { log } from '../utils/logger.js';
import type { DashboardSpec } from '../types/index.js';

const COLLECTION = 'chart_results';

export interface ChartResultEntry {
  prompt:      string;
  sourceName:  string;
  dashboard:   DashboardSpec;
  createdAt?:  Date;
}

class ChartResultsRepository {
  async save(entry: Omit<ChartResultEntry, 'createdAt'>): Promise<void> {
    try {
      const { db } = await getMongo();
      await db.collection(COLLECTION).insertOne({ ...entry, createdAt: new Date() });
      log('chart-results', `saved | source: ${entry.sourceName} | widgets: ${entry.dashboard.widgets.length}`);
    } catch (err) {
      log('chart-results', `save failed: ${err instanceof Error ? err.message : 'Failed'}`);
    }
  }

  async findRecent(limit = 20): Promise<ChartResultEntry[]> {
    try {
      const { db } = await getMongo();
      return await db.collection<ChartResultEntry>(COLLECTION)
        .find({})
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
    } catch (err) {
      log('chart-results', `findRecent failed: ${err instanceof Error ? err.message : 'Failed'}`);
      return [];
    }
  }

  async findBySource(sourceName: string, limit = 10): Promise<ChartResultEntry[]> {
    try {
      const { db } = await getMongo();
      return await db.collection<ChartResultEntry>(COLLECTION)
        .find({ sourceName })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
    } catch (err) {
      log('chart-results', `findBySource failed: ${err instanceof Error ? err.message : 'Failed'}`);
      return [];
    }
  }
}

export const chartRepo = new ChartResultsRepository();
