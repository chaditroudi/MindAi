import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type Document } from 'mongoose';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { log } from '../common/logger/app.logger';

export type MemoryType =
  | 'goal'
  | 'insight'
  | 'preference'
  | 'context'
  | 'decision'
  | 'entity'
  | 'correction';

@Schema({ timestamps: true, collection: 'memory_items' })
export class MemoryItem {
  @Prop({ required: true, index: true }) userId!: string;
  @Prop({ required: true }) sessionId!: string;
  @Prop({
    required: true,
    enum: [
      'goal',
      'insight',
      'preference',
      'context',
      'decision',
      'entity',
      'correction',
    ],
  })
  type!: MemoryType;
  @Prop({ required: true }) content!: string;
  @Prop({ type: [String], default: [] }) tags!: string[];
  @Prop({ min: 1, max: 5, default: 3 }) importance!: number;
}

export type MemoryItemDocument = MemoryItem & Document;
export const MemoryItemSchema = SchemaFactory.createForClass(MemoryItem);
MemoryItemSchema.index({ userId: 1, importance: -1, createdAt: -1 });
MemoryItemSchema.index({ userId: 1, tags: 1 });

export interface MemoryPayload {
  userId: string;
  sessionId: string;
  type: MemoryType;
  content: string;
  tags: string[];
  importance: number;
}

type RawDoc = {
  _id: Types.ObjectId;
  userId: string;
  sessionId: string;
  type: MemoryType;
  content: string;
  tags: string[];
  importance: number;
  createdAt?: Date;
};

@Injectable()
export class MemoryRepository {
  constructor(
    @InjectModel(MemoryItem.name)
    private readonly model: Model<MemoryItemDocument>,
  ) {}

  async upsert(items: MemoryPayload[]): Promise<void> {
    for (const item of items) {
      const fingerprint = item.content
        .slice(0, 60)
        .toLowerCase()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const existing = await this.model
        .findOne({
          userId: item.userId,
          type: item.type,
          content: { $regex: fingerprint, $options: 'i' },
        })
        .lean();

      if (existing) {
        await this.model.updateOne(
          { _id: (existing as { _id: Types.ObjectId })._id },
          {
            $set: {
              content: item.content,
              tags: item.tags,
              importance: item.importance,
              sessionId: item.sessionId,
            },
          },
        );
      } else {
        await this.model.create(item);
      }
    }
  }

  async findRelevant(
    userId: string,
    promptText: string,
    limit = 8,
  ): Promise<RawDoc[]> {
    const allDocs = (await this.model
      .find({ userId })
      .select('-embedding')
      .sort({ importance: -1, createdAt: -1 })
      .limit(100)
      .lean()) as RawDoc[];

    if (!allDocs.length) return [];

    const words = promptText
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3);

    const scored = allDocs.map((doc) => {
      const hits = doc.tags.filter((t) =>
        words.some(
          (w) => t.toLowerCase().includes(w) || w.includes(t.toLowerCase()),
        ),
      );
      const score =
        hits.length / Math.max(words.length, 1) + doc.importance / 20;
      return { doc, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.doc);
  }

  async listByUser(userId: string, limit = 50): Promise<RawDoc[]> {
    return this.model
      .find({ userId })
      .select('-embedding')
      .sort({ importance: -1, createdAt: -1 })
      .limit(limit)
      .lean();
  }

  async deleteByUser(userId: string): Promise<number> {
    const r = await this.model.deleteMany({ userId });
    return r.deletedCount;
  }
}
