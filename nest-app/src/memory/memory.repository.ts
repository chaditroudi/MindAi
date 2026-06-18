import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MemoryItem, type MemoryItemDocument, type MemoryType } from './memory.schema';

export interface MemoryPayload {
  userId:    string;
  sessionId: string;
  type:      MemoryType;
  content:   string;
  tags:      string[];
  importance: number;
}

@Injectable()
export class MemoryRepository {
  constructor(
    @InjectModel(MemoryItem.name)
    private readonly model: Model<MemoryItemDocument>,
  ) {}

  async upsert(items: MemoryPayload[]): Promise<void> {
    for (const item of items) {
      // Check for similar existing memory (same user + type + first 60 chars of content)
      const fingerprint = item.content.slice(0, 60).toLowerCase();
      const existing = await this.model.findOne({
        userId: item.userId,
        type:   item.type,
        content: { $regex: fingerprint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' },
      }).lean();

      if (existing) {
        await this.model.updateOne(
          { _id: (existing as { _id: Types.ObjectId })._id },
          { $set: { content: item.content, tags: item.tags, importance: item.importance, sessionId: item.sessionId } },
        );
      } else {
        await this.model.create(item);
      }
    }
  }

  async findRelevant(userId: string, tags: string[], limit = 10): Promise<MemoryItemDocument[]> {
    const tagFilter = tags.length
      ? await this.model.find({ userId, tags: { $in: tags }, importance: { $gte: 2 } })
          .sort({ importance: -1, createdAt: -1 })
          .limit(limit)
          .lean()
      : [];

    const needed = limit - tagFilter.length;
    if (needed <= 0) return tagFilter as unknown as MemoryItemDocument[];

    const excludeIds = tagFilter.map(m => (m as { _id: Types.ObjectId })._id);
    const recent = await this.model
      .find({ userId, ...(excludeIds.length ? { _id: { $nin: excludeIds } } : {}) })
      .sort({ importance: -1, createdAt: -1 })
      .limit(needed)
      .lean();

    return [...tagFilter, ...recent] as unknown as MemoryItemDocument[];
  }

  async listByUser(userId: string, limit = 50): Promise<MemoryItemDocument[]> {
    return this.model
      .find({ userId })
      .sort({ importance: -1, createdAt: -1 })
      .limit(limit)
      .lean() as unknown as MemoryItemDocument[];
  }

  async deleteByUser(userId: string): Promise<number> {
    const r = await this.model.deleteMany({ userId });
    return r.deletedCount;
  }
}
