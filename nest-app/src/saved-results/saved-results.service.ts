import { Injectable } from '@nestjs/common';
import { SavedResultsRepository, type SavedResultPayload } from './saved-results.repository';

@Injectable()
export class SavedResultsService {
  constructor(private readonly repo: SavedResultsRepository) {}

  list(userId: string) {
    return this.repo.list(userId);
  }

  findOne(id: string, userId: string) {
    return this.repo.findOne(id, userId);
  }

  save(payload: SavedResultPayload) {
    return this.repo.save(payload);
  }

  remove(id: string, userId: string) {
    return this.repo.remove(id, userId);
  }
}
