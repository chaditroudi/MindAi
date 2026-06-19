import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MemoryItem, type MemoryItemDocument, type MemoryType } from './memory.schema';
import { generateEmbedding, cosineSimilarity } from '../ai/embeddings';
import { log } from '../common/logger/app.logger';

export interface MemoryPayload {
  userId:     string;
  sessionId:  string;
  type:       MemoryType;
  content:    string;
  tags:       string[];
  importance: number;
}

type RawDoc = {
  _id:        Types.ObjectId;
  userId:     string;
  sessionId:  string;
  type:       MemoryType;
  content:    string;
  tags:       string[];
  importance: number;
  embedding:  number[];
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
      // Generate embedding for semantic retrieval
      let embedding: number[] = [];
      try {
        embedding = await generateEmbedding(item.content);
      } catch (err) {
        log('memory-repo', `embedding failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
      }

      // Deduplicate by content fingerprint (first 60 chars)
      const fingerprint = item.content.slice(0, 60).toLowerCase()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const existing = await this.model.findOne({
        userId:  item.userId,
        type:    item.type,
        content: { $regex: fingerprint, $options: 'i' },
      }).lean();

      if (existing) {
        await this.model.updateOne(
          { _id: (existing as RawDoc)._id },
          { $set: { content: item.content, tags: item.tags, importance: item.importance, sessionId: item.sessionId, embedding } },
        );
      } else {
        await this.model.create({ ...item, embedding });
      }
    }
  }

  /**
   * Semantic retrieval using cosine similarity between the prompt embedding and stored memory embeddings.
   * Falls back to tag + recency scoring for memories that have no embedding yet.
   */
  async findRelevant(userId: string, promptText: string, limit = 8): Promise<RawDoc[]> {
    const allDocs = await this.model
      .find({ userId })
      .sort({ importance: -1, createdAt: -1 })
      .limit(100)
      .lean() as RawDoc[];

    if (!allDocs.length) return [];

    // Attempt semantic scoring
    let promptEmbedding: number[] | null = null;
    try {
      promptEmbedding = await generateEmbedding(promptText);
    } catch {
      // Model not ready yet — use fallback scoring
    }

    const scored = allDocs.map(doc => {
      let score: number;

      if (promptEmbedding && doc.embedding?.length === promptEmbedding.length) {
        // True semantic similarity (0 to 1 range after normalised vectors)
        score = cosineSimilarity(promptEmbedding, doc.embedding);
      } else {
        // Fallback: keyword overlap + importance boost
        const words = promptText.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        const hits  = doc.tags.filter(t => words.some(w => t.toLowerCase().includes(w) || w.includes(t.toLowerCase())));
        score = (hits.length / Math.max(words.length, 1)) + (doc.importance / 20);
      }

      return { doc, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(s => s.doc);
  }

  async listByUser(userId: string, limit = 50): Promise<Omit<RawDoc, 'embedding'>[]> {
    return this.model
      .find({ userId })
      .select('-embedding')
      .sort({ importance: -1, createdAt: -1 })
      .limit(limit)
      .lean() as unknown as Omit<RawDoc, 'embedding'>[];
  }

  async deleteByUser(userId: string): Promise<number> {
    const r = await this.model.deleteMany({ userId });
    return r.deletedCount;
  }
}
