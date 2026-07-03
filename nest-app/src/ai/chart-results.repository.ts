import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, type HydratedDocument } from 'mongoose';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { DashboardSpec } from '../types';

/**
 * ChartResult
 * -----------
 * A durable log of every dashboard the chart skill has ever generated —
 * distinct from the short-lived, TTL'd entries in CacheService (which exist
 * purely to skip a repeated LLM call). This collection has no expiry and no
 * read path exposed anywhere in the app today; it's write-only telemetry,
 * useful for later analysis of what charts got generated for which sources,
 * not something currently surfaced to end users.
 */
@Schema({ collection: 'chart_results', versionKey: false, timestamps: true })
export class ChartResult {
  @Prop({ required: true })
  prompt: string;

  @Prop({ required: true, index: true })
  sourceName: string;

  // Mixed = "store whatever shape this is," since a DashboardSpec's widgets
  // array is a free-form ECharts option object per widget, not something a
  // fixed Mongoose schema could usefully constrain.
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

  /**
   * Fire-and-forget style write: a failure here is logged but never thrown,
   * because losing this telemetry record must never fail the actual
   * dashboard response the user is waiting on.
   */
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
