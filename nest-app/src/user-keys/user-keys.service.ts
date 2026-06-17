import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserApiKey, type UserApiKeyDocument } from './schemas/user-api-key.schema';

@Injectable()
export class UserKeysService {
  constructor(
    @InjectModel(UserApiKey.name)
    private readonly model: Model<UserApiKeyDocument>,
  ) {}

  async save(userId: string, apiKey: string): Promise<void> {
    await this.model.findOneAndUpdate(
      { userId },
      { $set: { apiKey } },
      { upsert: true, returnDocument: 'after' },
    );
  }

  async get(userId: string): Promise<string | null> {
    const doc = await this.model.findOne({ userId }, { apiKey: 1 }).lean();
    return doc?.apiKey ?? null;
  }

  async delete(userId: string): Promise<void> {
    await this.model.deleteOne({ userId });
  }
}
