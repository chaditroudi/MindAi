import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PromptCache, PromptCacheSchema, CacheService } from './cache.service';
import { CacheController } from './cache.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PromptCache.name, schema: PromptCacheSchema },
    ]),
  ],
  controllers: [CacheController],
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
