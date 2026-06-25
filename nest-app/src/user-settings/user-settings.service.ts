import { Injectable } from '@nestjs/common';
import { UserSettingsRepository } from './user-settings.repository';
import type { UserSettingsDocument } from '../ai/schemas/user-settings.schema';

export interface UserSettingsDto {
  apiKey:   string;
  provider: string;
  model:    string;
}

@Injectable()
export class UserSettingsService {
  constructor(private readonly repo: UserSettingsRepository) {}

  async save(userId: string, dto: UserSettingsDto): Promise<void> {
    await this.repo.save(userId, dto);
  }

  async findByUser(userId: string): Promise<UserSettingsDocument | null> {
    return this.repo.findByUser(userId);
  }

  async deleteByUser(userId: string): Promise<void> {
    await this.repo.deleteByUser(userId);
  }
}
