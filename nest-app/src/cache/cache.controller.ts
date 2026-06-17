import { Controller, Get, Delete, Body } from '@nestjs/common';
import { CacheService } from './cache.service';

@Controller('api/cache')
export class CacheController {
  constructor(private readonly cache: CacheService) {}

  @Get()
  list() {
    return this.cache.list();
  }

  @Delete()
  async remove(@Body() body: { key?: string }) {
    if (body.key) return this.cache.deleteEntry(body.key);
    return this.cache.clearAll();
  }
}
