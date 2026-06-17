import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { SavedResult, type SavedResultDocument } from './schemas/saved-result.schema';

export interface SavedResultPayload {
  userId: string;
  title:  string;
  prompt: string;
  intent: 'dashboard' | 'report' | 'inquiry';
  result: unknown;
}

@Injectable()
export class SavedResultsRepository {
  constructor(
    @InjectModel(SavedResult.name)
    private readonly model: Model<SavedResultDocument>,
  ) {}

  async save(payload: SavedResultPayload): Promise<string> {
    const doc = await this.model.create(payload);
    return doc._id.toHexString();
  }

  async list(userId: string) {
    const docs = await this.model
      .find({ userId }, { result: 0 })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return docs.map(d => ({
      id:        (d._id as Types.ObjectId).toHexString(),
      title:     d.title,
      prompt:    d.prompt,
      intent:    d.intent,
      createdAt: (d.createdAt as unknown as Date).toISOString(),
    }));
  }

  async findOne(id: string, userId: string) {
    if (!Types.ObjectId.isValid(id)) return null;
    const doc = await this.model.findOne({ _id: id, userId }).lean();
    if (!doc) return null;
    return {
      id:        (doc._id as Types.ObjectId).toHexString(),
      title:     doc.title,
      prompt:    doc.prompt,
      intent:    doc.intent,
      result:    doc.result,
      createdAt: (doc.createdAt as unknown as Date).toISOString(),
    };
  }

  async remove(id: string, userId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;
    const r = await this.model.deleteOne({ _id: id, userId });
    return r.deletedCount > 0;
  }
}
