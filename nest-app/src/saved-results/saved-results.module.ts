import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SavedResult, SavedResultSchema } from './schemas/saved-result.schema';
import { SavedResultsController } from './saved-results.controller';
import { SavedResultsRepository } from './saved-results.repository';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: SavedResult.name, schema: SavedResultSchema }]),
  ],
  controllers: [SavedResultsController],
  providers:   [SavedResultsRepository],
})
export class SavedResultsModule {}
