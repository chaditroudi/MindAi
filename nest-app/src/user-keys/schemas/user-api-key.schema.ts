import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type UserApiKeyDocument = HydratedDocument<UserApiKey>;

@Schema({ collection: 'user_api_keys', versionKey: false, timestamps: true })
export class UserApiKey {
  @Prop({ required: true, unique: true, index: true, trim: true })
  userId: string;

  @Prop({ required: true })
  apiKey: string;
}

export const UserApiKeySchema = SchemaFactory.createForClass(UserApiKey);
