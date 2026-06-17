import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, type HydratedDocument } from 'mongoose';

export type PipelineRunDocument = HydratedDocument<PipelineRun>;

@Schema({ collection: 'results_history', versionKey: false, timestamps: true, suppressReservedKeysWarning: true })
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

export const PipelineRunSchema = SchemaFactory.createForClass(PipelineRun);
