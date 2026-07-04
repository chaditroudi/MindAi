import { Controller, Get, Delete, Patch, Body, Headers } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { ApiTags } from '@nestjs/swagger';
import { MemoryService } from './memory.service';
import { requireUserId } from '../common/helpers/user-id';

class MemoryConfigDto {
  @IsBoolean()
  extractionEnabled!: boolean;
}

@ApiTags('memory')
@Controller('api/memory')
export class MemoryController {
  constructor(private readonly service: MemoryService) {}

  @Get('config')
  getConfig() {
    return { extractionEnabled: this.service.getEnabled() };
  }

  @Patch('config')
  setConfig(@Body() dto: MemoryConfigDto) {
    this.service.setEnabled(dto.extractionEnabled);
    return {
      ok: true,
      extractionEnabled: dto.extractionEnabled,
      message: `Memory extraction ${dto.extractionEnabled ? 'enabled' : 'disabled'}`,
    };
  }

  @Get()
  async list(@Headers('x-user-id') rawUserId: string) {
    const userId = requireUserId(rawUserId);
    return this.service.list(userId);
  }

  @Delete()
  async clear(@Headers('x-user-id') rawUserId: string) {
    const userId = requireUserId(rawUserId);
    const deleted = await this.service.clear(userId);
    return { ok: true, deleted };
  }
}
