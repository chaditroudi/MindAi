import { Controller, Get, Delete, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CacheService } from './cache.service';

@ApiTags('cache')
@Controller('api/cache')
export class CacheController {
  constructor(private readonly cache: CacheService) {}

  @Get()
  list() {
    return this.cache.list();
  }

  @Delete(':key')
  deleteOne(@Param('key') key: string) {
    return this.cache.deleteEntry(key);
  }

  @Delete()
  clearAll() {
    return this.cache.clearAll();
  }
}
