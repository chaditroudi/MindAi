import { Controller, Get, Delete, Param } from '@nestjs/common';
import { CacheService } from './cache.service';

@Controller('api/cache')
export class CacheController {
  constructor(private readonly cache: CacheService) {}

  @Get()
  list() {
    return this.cache.list();
  }

  /** Delete a single entry by its SHA-256 key */
  @Delete(':key')
  deleteOne(@Param('key') key: string) {
    return this.cache.deleteEntry(key);
  }

  /** Clear all cache entries */
  @Delete()
  clearAll() {
    return this.cache.clearAll();
  }
}
