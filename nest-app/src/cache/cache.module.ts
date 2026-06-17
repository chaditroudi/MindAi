import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PromptCache, PromptCacheSchema } from './schemas/prompt-cache.schema';
import { CacheController } from './cache.controller';
import { CacheService } from './cache.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: PromptCache.name, schema: PromptCacheSchema }]),
  ],
  controllers: [CacheController],
  providers:   [CacheService],
  exports:     [CacheService],
})
export class CacheModule {}
