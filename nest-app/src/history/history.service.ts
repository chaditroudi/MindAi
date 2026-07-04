import { Injectable } from '@nestjs/common';
import {
  ResultsHistoryRepository,
  type PipelineRunEntry,
} from './results-history.repository';
import {
  listSessions,
  getSessionDetail,
  deleteSession,
} from '../session/memory';

@Injectable()
export class HistoryService {
  constructor(private readonly repo: ResultsHistoryRepository) {}

  async listResults(filter: { intent?: string; skip: number; limit: number }) {
    const [items, total] = await Promise.all([
      this.repo.list(filter),
      this.repo.count({ intent: filter.intent }),
    ]);
    return { total, skip: filter.skip, limit: filter.limit, items };
  }

  findResultById(id: string) {
    return this.repo.findById(id);
  }

  save(entry: PipelineRunEntry): Promise<string> {
    return this.repo.save(entry);
  }

  listSessions() {
    return listSessions();
  }

  getSessionDetail(sessionId: string) {
    return getSessionDetail(sessionId);
  }

  deleteSession(sessionId: string) {
    return deleteSession(sessionId);
  }
}
