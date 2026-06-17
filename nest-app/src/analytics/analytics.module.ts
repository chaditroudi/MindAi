import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChartResult, ChartResultSchema } from '../ai/schemas/chart-result.schema';
import { ChartResultsRepository } from '../ai/chart-results.repository';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { PipelineService } from './pipeline.service';
import { UserKeysModule } from '../user-keys/user-keys.module';
import { CacheModule } from '../cache/cache.module';
import { HistoryModule } from '../history/history.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: ChartResult.name, schema: ChartResultSchema }]),
    UserKeysModule,
    CacheModule,
    HistoryModule,
  ],
  controllers: [AnalyticsController],
  providers:   [AnalyticsService, PipelineService, ChartResultsRepository],
})
export class AnalyticsModule {}
