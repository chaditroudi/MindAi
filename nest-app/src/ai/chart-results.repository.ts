import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, type HydratedDocument } from 'mongoose';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { DashboardSpec } from '../types';

@Schema({ collection: 'chart_results', versionKey: false, timestamps: true })
export class ChartResult {
  @Prop({ required: true })
  prompt: string;

  @Prop({ required: true, index: true })
  sourceName: string;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  dashboard: DashboardSpec;
}

export type ChartResultDocument = HydratedDocument<ChartResult>;
export const ChartResultSchema = SchemaFactory.createForClass(ChartResult);

export interface ChartResultEntry {
  prompt: string;
  sourceName: string;
  dashboard: DashboardSpec;
}

@Injectable()
export class ChartResultsRepository {
  private readonly logger = new Logger(ChartResultsRepository.name);

  constructor(
    @InjectModel(ChartResult.name)
    private readonly model: Model<ChartResultDocument>,
  ) {}

  async save(entry: ChartResultEntry): Promise<void> {
    try {
      await this.model.create(entry);
      this.logger.log(
        `saved | source: ${entry.sourceName} | widgets: ${entry.dashboard.widgets.length}`,
      );
    } catch (err) {
      this.logger.error(
        `save failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

