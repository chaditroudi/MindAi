import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PipelineRun, PipelineRunSchema } from './schemas/pipeline-run.schema';
import { HistoryController } from './history.controller';
import { HistoryService } from './history.service';
import { ResultsHistoryRepository } from './results-history.repository';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: PipelineRun.name, schema: PipelineRunSchema }]),
  ],
  controllers: [HistoryController],
  providers:   [HistoryService, ResultsHistoryRepository],
  exports:     [HistoryService],
})
export class HistoryModule {}
