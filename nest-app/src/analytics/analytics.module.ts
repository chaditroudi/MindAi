import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChartResult, ChartResultSchema } from '../ai/chart-results.repository';
import { ChartResultsRepository } from '../ai/chart-results.repository';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { PipelineService } from './pipeline.service';
import { CacheModule } from '../cache/cache.module';
import { HistoryModule } from '../history/history.module';
import { MemoryModule } from '../memory/memory.module';
import { UserSettingsModule } from '../user-settings/user-settings.module';
import { AgentConfigModule } from '../agent-config/agent-config.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: ChartResult.name, schema: ChartResultSchema }]),
    CacheModule,
    HistoryModule,
    MemoryModule,
    UserSettingsModule,
    AgentConfigModule,
  ],
  controllers: [AnalyticsController],
  providers:   [AnalyticsService, PipelineService, ChartResultsRepository],
})
export class AnalyticsModule {}
