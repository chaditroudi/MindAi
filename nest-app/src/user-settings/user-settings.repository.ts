import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument } from 'mongoose';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

@Schema({ collection: 'user_settings', timestamps: true, versionKey: false })
export class UserSettings {
  @Prop({ required: true, unique: true, index: true }) userId!:   string;
  @Prop({ required: true })                            apiKey!:   string;
  @Prop({ required: true })                            provider!: string;
  @Prop({ required: true })                            model!:    string;

  @Prop({ min: 1, default: 4_000 }) inputTokenLimit?: number;

  // Lifetime accumulated usage for this user's personal key
  @Prop({ min: 0, default: 0 }) inputTokensUsed!:  number;
  @Prop({ min: 0, default: 0 }) outputTokensUsed!: number;
}

export type UserSettingsDocument = HydratedDocument<UserSettings>;
export const UserSettingsSchema = SchemaFactory.createForClass(UserSettings);

@Injectable()
export class UserSettingsRepository {
  constructor(
    @InjectModel(UserSettings.name)
    private readonly model: Model<UserSettingsDocument>,
  ) {}

  async save(userId: string, data: {
    apiKey:           string;
    provider:         string;
    model:            string;
    inputTokenLimit?: number;
  }): Promise<void> {
    await this.model.replaceOne({ userId }, { userId, ...data }, { upsert: true });
  }

  async findByUser(userId: string): Promise<UserSettingsDocument | null> {
    return this.model.findOne({ userId }).lean() as Promise<UserSettingsDocument | null>;
  }

  async patchTokenLimit(userId: string, inputTokenLimit: number): Promise<boolean> {
    const result = await this.model.updateOne({ userId }, { $set: { inputTokenLimit } });
    return result.matchedCount > 0;
  }

  async incrementUsage(userId: string, inputTokens: number, outputTokens: number): Promise<void> {
    await this.model.updateOne(
      { userId },
      { $inc: { inputTokensUsed: inputTokens, outputTokensUsed: outputTokens } },
    );
  }

  async deleteByUser(userId: string): Promise<void> {
    await this.model.deleteOne({ userId });
  }
}
