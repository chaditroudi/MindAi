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

@Schema({ collection: 'memory_settings', versionKey: false })
export class MemorySettings {
  @Prop({ type: Boolean, required: true }) extractionEnabled!: boolean;
}

export type MemorySettingsDocument = MemorySettings & Document;
export const MemorySettingsSchema =
  SchemaFactory.createForClass(MemorySettings);

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

// Two memories with the same userId+type are treated as "the same goal
// restated" when their significant words overlap at least this much
// (Jaccard similarity). Chosen from real examples: "show budget vs duration
// for all projects" vs "...for projects" share 3/3 words (1.0); vs "...for
// projects of 4 municipalities" share 3/4 (0.75); vs an unrelated "list all
// cancelled projects" share only 1/4 (0.25) — 0.5 cleanly separates the two.
const DEDUPE_SIMILARITY_THRESHOLD = Number(
  process.env['MEMORY_DEDUPE_SIMILARITY_THRESHOLD'] ?? 0.5,
);

// Common words that carry no topical meaning for similarity comparison —
// filtering them out is what lets "show X for all Y" and "list X for Y"
// match on the words that actually matter (X, Y).
const STOPWORDS = new Set([
  'the', 'a', 'an', 'for', 'of', 'to', 'and', 'or', 'in', 'on', 'at', 'is',
  'are', 'was', 'were', 'all', 'show', 'list', 'give', 'me', 'please',
]);

function significantWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2 && !STOPWORDS.has(word)),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const word of a) if (b.has(word)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union ? intersection / union : 0;
}

@Injectable()
export class MemoryRepository {
  constructor(
    @InjectModel(MemoryItem.name)
    private readonly model: Model<MemoryItemDocument>,
    @InjectModel(MemorySettings.name)
    private readonly settingsModel: Model<MemorySettingsDocument>,
  ) {}

  async getExtractionEnabled(): Promise<boolean | null> {
    const doc = await this.settingsModel.findOne().lean();
    return doc ? doc.extractionEnabled : null;
  }

  async setExtractionEnabled(enabled: boolean): Promise<void> {
    await this.settingsModel.updateOne(
      {},
      { $set: { extractionEnabled: enabled } },
      { upsert: true },
    );
  }

  async upsert(items: MemoryPayload[]): Promise<void> {
    for (const item of items) {
      const candidates = await this.model
        .find({ userId: item.userId, type: item.type })
        .select('content')
        .limit(100)
        .lean();

      const newWords = significantWords(item.content);
      let bestMatch: { _id: Types.ObjectId } | null = null;
      let bestScore = 0;
      for (const candidate of candidates) {
        const score = jaccardSimilarity(
          newWords,
          significantWords(candidate.content),
        );
        if (score > bestScore) {
          bestScore = score;
          bestMatch = candidate as { _id: Types.ObjectId };
        }
      }

      if (bestMatch && bestScore >= DEDUPE_SIMILARITY_THRESHOLD) {
        await this.model.updateOne(
          { _id: bestMatch._id },
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
      .sort({ importance: -1, createdAt: -1 })
      .limit(limit)
      .lean();
  }

  async deleteByUser(userId: string): Promise<number> {
    const r = await this.model.deleteMany({ userId });
    return r.deletedCount;
  }
}
