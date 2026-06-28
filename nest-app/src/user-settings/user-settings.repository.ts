import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument } from 'mongoose';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

@Schema({ collection: 'user_settings', timestamps: true, versionKey: false })
export class UserSettings {
  @Prop({ required: true, unique: true, index: true })
  userId!: string;

  @Prop({ required: true })
  apiKey!: string;

  @Prop({ required: true })
  provider!: string;

  @Prop({ required: true })
  model!: string;
}

export type UserSettingsDocument = HydratedDocument<UserSettings>;
export const UserSettingsSchema = SchemaFactory.createForClass(UserSettings);

@Injectable()
export class UserSettingsRepository {
  constructor(
    @InjectModel(UserSettings.name)
    private readonly model: Model<UserSettingsDocument>,
  ) {}

  async save(userId: string, data: { apiKey: string; provider: string; model: string }): Promise<void> {
    await this.model.replaceOne({ userId }, { userId, ...data }, { upsert: true });
  }

  async findByUser(userId: string): Promise<UserSettingsDocument | null> {
    return this.model.findOne({ userId }).lean() as Promise<UserSettingsDocument | null>;
  }

  async deleteByUser(userId: string): Promise<void> {
    await this.model.deleteOne({ userId });
  }
}
