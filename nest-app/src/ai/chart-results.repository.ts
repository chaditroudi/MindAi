import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ChartResult, type ChartResultDocument } from './schemas/chart-result.schema';
import type { DashboardSpec } from '../types';

export interface ChartResultEntry {
  prompt:     string;
  sourceName: string;
  dashboard:  DashboardSpec;
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
      this.logger.log(`saved | source: ${entry.sourceName} | widgets: ${entry.dashboard.widgets.length}`);
    } catch (err) {
      this.logger.error(`save failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
