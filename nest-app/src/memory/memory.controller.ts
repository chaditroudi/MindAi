import { Controller, Get, Delete, Headers, UnauthorizedException } from '@nestjs/common';
import { MemoryService } from './memory.service';

function requireUserId(raw: string | undefined): string {
  const id = raw?.trim();
  if (!id) throw new UnauthorizedException('User ID missing.');
  return id;
}

@Controller('api/memory')
export class MemoryController {
  constructor(private readonly service: MemoryService) {}

  /** List all stored long-term memories for the current user */
  @Get()
  async list(@Headers('x-user-id') rawUserId: string) {
    const userId = requireUserId(rawUserId);
    const items = await this.service.list(userId);
    return items;
  }

  /** Clear all long-term memories for the current user */
  @Delete()
  async clear(@Headers('x-user-id') rawUserId: string) {
    const userId  = requireUserId(rawUserId);
    const deleted = await this.service.clear(userId);
    return { ok: true, deleted };
  }
}
