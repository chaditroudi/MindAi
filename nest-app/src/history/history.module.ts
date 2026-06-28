import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PipelineRun, PipelineRunSchema, ResultsHistoryRepository } from './results-history.repository';
import { HistoryController } from './history.controller';
import { HistoryService } from './history.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: PipelineRun.name, schema: PipelineRunSchema }]),
  ],
  controllers: [HistoryController],
  providers:   [HistoryService, ResultsHistoryRepository],
  exports:     [HistoryService],
})
export class HistoryModule {}
