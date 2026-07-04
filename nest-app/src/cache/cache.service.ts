import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, type HydratedDocument } from 'mongoose';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash } from 'node:crypto';

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

  @Prop({ type: Date, default: Date.now, expires: 7 * 24 * 3600 })
  createdAt: Date;
}

export type PromptCacheDocument = HydratedDocument<PromptCache>;
export const PromptCacheSchema = SchemaFactory.createForClass(PromptCache);

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(
    @InjectModel(PromptCache.name)
    private readonly model: Model<PromptCacheDocument>,
  ) {}

  cacheKey(intent: string, prompt: string): string {
    return createHash('sha256')
      .update(`${intent}:${prompt.trim().toLowerCase().replace(/\s+/g, ' ')}`)
      .digest('hex')
      .slice(0, 24);
  }

  async getCached<T>(intent: string, prompt: string): Promise<T | null> {
    const key = this.cacheKey(intent, prompt);
    const entry = await this.model
      .findOneAndUpdate(
        { key },
        { $inc: { hitCount: 1 }, $set: { lastHitAt: new Date() } },
        { returnDocument: 'after' },
      )
      .lean<PromptCacheDocument>();

    if (entry) {
      this.logger.log(
        `CACHE HIT  | key: ${key} | hits: ${entry.hitCount} | intent: ${intent}`,
      );
    }
    return (entry?.result as T) ?? null;
  }

  async setCached<T>(intent: string, prompt: string, result: T): Promise<void> {
    const key = this.cacheKey(intent, prompt);
    await this.model.updateOne(
      { key },
      {

        $setOnInsert: { key, createdAt: new Date() },
        $set: {
          prompt: prompt.trim(),
          intent,
          result,
          hitCount: 0,
          lastHitAt: new Date(),
        },
      },
      { upsert: true },
    );
    this.logger.log(`CACHE SAVE | key: ${key} | intent: ${intent}`);
  }

  async list() {
    const entries = await this.model
      .find({}, { result: 0 })
      .sort({ lastHitAt: -1 })
      .limit(100)
      .lean();
    return { count: entries.length, entries };
  }

  async deleteEntry(key: string): Promise<{ ok: boolean; key: string }> {
    const r = await this.model.deleteOne({ key });
    return { ok: r.deletedCount > 0, key };
  }

  async clearAll(): Promise<{ ok: boolean; deleted: number }> {
    const r = await this.model.deleteMany({});
    this.logger.log(`cleared all | deleted: ${r.deletedCount}`);
    return { ok: true, deleted: r.deletedCount };
  }
}
