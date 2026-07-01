import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  SavedResult,
  SavedResultSchema,
  SavedResultsRepository,
} from './saved-results.repository';
import { SavedResultsController } from './saved-results.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SavedResult.name, schema: SavedResultSchema },
    ]),
  ],
  controllers: [SavedResultsController],
  providers: [SavedResultsRepository],
})
export class SavedResultsModule {}
