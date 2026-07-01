import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, type HydratedDocument } from 'mongoose';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

@Schema({ collection: 'saved_results', versionKey: false, timestamps: true })
export class SavedResult {
  @Prop({ required: true, index: true, trim: true })
  userId: string;

  @Prop({ required: true, maxlength: 200, trim: true })
  title: string;

  @Prop({ required: true, maxlength: 1000 })
  prompt: string;

  @Prop({ required: true, enum: ['dashboard', 'report', 'inquiry'] })
  intent: 'dashboard' | 'report' | 'inquiry';

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  result: unknown;

  createdAt!: Date;
  updatedAt!: Date;
}

export type SavedResultDocument = HydratedDocument<SavedResult>;
export const SavedResultSchema = SchemaFactory.createForClass(SavedResult);
SavedResultSchema.index({ userId: 1, createdAt: -1 });

export interface SavedResultPayload {
  userId: string;
  title: string;
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
    return docs.map((d) => ({
      id: d._id.toHexString(),
      title: d.title,
      prompt: d.prompt,
      intent: d.intent,
      createdAt: d.createdAt.toISOString(),
    }));
  }

  async findOne(id: string, userId: string) {
    if (!Types.ObjectId.isValid(id)) return null;
    const doc = await this.model.findOne({ _id: id, userId }).lean();
    if (!doc) return null;
    return {
      id: doc._id.toHexString(),
      title: doc.title,
      prompt: doc.prompt,
      intent: doc.intent,
      result: doc.result,
      createdAt: doc.createdAt.toISOString(),
    };
  }

  async remove(id: string, userId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;
    const r = await this.model.deleteOne({ _id: id, userId });
    return r.deletedCount > 0;
  }
}
