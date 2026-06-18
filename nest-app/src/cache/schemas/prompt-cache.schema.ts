import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, type HydratedDocument } from 'mongoose';

export type PromptCacheDocument = HydratedDocument<PromptCache>;

@Schema({ collection: 'prompt_cache', versionKey: false })
export class PromptCache {
  @Prop({ required: true, unique: true, index: true })
  key: string;

  @Prop({ required: true })
  prompt: string;

  @Prop({ required: true, index: true })
  intent: string;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  result: unknown;

  @Prop({ type: Number, default: 0 })
  hitCount: number;

  @Prop({ type: Date, default: Date.now })
  lastHitAt: Date;

  // TTL index: documents expire 7 days after creation
  @Prop({ type: Date, default: Date.now, expires: 7 * 24 * 3600 })
  createdAt: Date;
}

export const PromptCacheSchema = SchemaFactory.createForClass(PromptCache);
