import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChartResult, ChartResultSchema } from '../ai/schemas/chart-result.schema';
import { ChartResultsRepository } from '../ai/chart-results.repository';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { PipelineService } from './pipeline.service';
import { CacheModule } from '../cache/cache.module';
import { HistoryModule } from '../history/history.module';
import { MemoryModule } from '../memory/memory.module';
import { UserSettingsModule } from '../user-settings/user-settings.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: ChartResult.name, schema: ChartResultSchema }]),
    CacheModule,
    HistoryModule,
    MemoryModule,
    UserSettingsModule,
  ],
  controllers: [AnalyticsController],
  providers:   [AnalyticsService, PipelineService, ChartResultsRepository],
})
export class AnalyticsModule {}
