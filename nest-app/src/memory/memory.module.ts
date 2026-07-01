import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  MemoryItem,
  MemoryItemSchema,
  MemoryRepository,
} from './memory.repository';
import { MemoryService } from './memory.service';
import { MemoryController } from './memory.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MemoryItem.name, schema: MemoryItemSchema },
    ]),
  ],
  providers: [MemoryRepository, MemoryService],
  controllers: [MemoryController],
  exports: [MemoryService],
})
export class MemoryModule {}
