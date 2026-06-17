import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, type HydratedDocument } from 'mongoose';
import type { DashboardSpec } from '../../types';

export type ChartResultDocument = HydratedDocument<ChartResult>;

@Schema({ collection: 'chart_results', versionKey: false, timestamps: true })
export class ChartResult {
  @Prop({ required: true })
  prompt: string;

  @Prop({ required: true, index: true })
  sourceName: string;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  dashboard: DashboardSpec;
}

export const ChartResultSchema = SchemaFactory.createForClass(ChartResult);
