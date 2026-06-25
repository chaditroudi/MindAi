import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type UserSettingsDocument = HydratedDocument<UserSettings>;

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

export const UserSettingsSchema = SchemaFactory.createForClass(UserSettings);
