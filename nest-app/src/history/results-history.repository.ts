import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, type HydratedDocument } from 'mongoose';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

@Schema({
  collection: 'results_history',
  versionKey: false,
  timestamps: true,
  suppressReservedKeysWarning: true,
})
export class PipelineRun {
  @Prop({ required: true, index: true })
  prompt: string;

  @Prop({ required: true, index: true })
  intent: string;

  @Prop({ required: true })
  collection: string;

  @Prop({ type: [MongooseSchema.Types.Mixed], required: true })
  pipeline: unknown[];

  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  rows: Record<string, unknown>[];

  @Prop({ required: true })
  rowCount: number;

  @Prop({ required: true })
  durationMs: number;
}

export type PipelineRunDocument = HydratedDocument<PipelineRun>;
export const PipelineRunSchema = SchemaFactory.createForClass(PipelineRun);

export interface PipelineRunEntry {
  prompt: string;
  intent: string;
  collection: string;
  pipeline: unknown[];
  rows: Record<string, unknown>[];
  rowCount: number;
  durationMs: number;
}

@Injectable()
export class ResultsHistoryRepository {
  private readonly logger = new Logger(ResultsHistoryRepository.name);

  constructor(
    @InjectModel(PipelineRun.name)
    private readonly model: Model<PipelineRunDocument>,
  ) {}

  async save(entry: PipelineRunEntry): Promise<string> {
    try {
      const doc = await this.model.create(
        entry as unknown as Record<string, unknown>,
      );
      return (doc._id as { toHexString(): string }).toHexString();
    } catch (err) {
      this.logger.error(`save failed: ${String(err)}`);
      return '';
    }
  }

  async list(filter: { intent?: string; skip?: number; limit?: number }) {
    const query = filter.intent ? { intent: filter.intent } : {};
    return this.model
      .find(query)
      .sort({ createdAt: -1 })
      .skip(filter.skip ?? 0)
      .limit(Math.min(filter.limit ?? 20, 100))
      .lean();
  }

  async findById(id: string) {
    if (!/^[a-f\d]{24}$/i.test(id)) return null;
    return this.model.findById(id).lean();
  }

  async count(filter: { intent?: string }): Promise<number> {
    const query = filter.intent ? { intent: filter.intent } : {};
    return this.model.countDocuments(query);
  }

  async deleteById(id: string): Promise<boolean> {
    if (!/^[a-f\d]{24}$/i.test(id)) return false;
    const r = await this.model.deleteOne({ _id: id });
    return r.deletedCount === 1;
  }
}
