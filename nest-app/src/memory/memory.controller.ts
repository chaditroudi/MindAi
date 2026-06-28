import { Controller, Get, Delete, Patch, Body, Headers } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { MemoryService } from './memory.service';
import { requireUserId } from '../common/helpers/user-id';

class MemoryConfigDto {
  @IsBoolean()
  extractionEnabled!: boolean;
}

@Controller('api/memory')
export class MemoryController {
  constructor(private readonly service: MemoryService) {}

  // ── GET /api/memory/config ────────────────────────────────────────────────
  // Returns the current memory extraction toggle state.
  // No auth header needed — this is a server config read.
  //
  // Response: { extractionEnabled: true | false }
  @Get('config')
  getConfig() {
    return { extractionEnabled: this.service.getEnabled() };
  }

  // ── PATCH /api/memory/config ──────────────────────────────────────────────
  // Enables or disables memory extraction at runtime without restarting.
  //
  // Body: { "extractionEnabled": false }   ← disables LLM Call #3, saves tokens
  // Body: { "extractionEnabled": true  }   ← re-enables memory extraction
  //
  // Effect is immediate — the next request after this call will respect the new state.
  // The state resets to the MEMORY_EXTRACTION_ENABLED env var value on server restart.
  @Patch('config')
  setConfig(@Body() dto: MemoryConfigDto) {
    this.service.setEnabled(dto.extractionEnabled);
    return {
      ok: true,
      extractionEnabled: dto.extractionEnabled,
      message: `Memory extraction ${dto.extractionEnabled ? 'enabled' : 'disabled'}`,
    };
  }

  // ── GET /api/memory ───────────────────────────────────────────────────────
  // List all stored long-term memories for the current user.
  @Get()
  async list(@Headers('x-user-id') rawUserId: string) {
    const userId = requireUserId(rawUserId);
    const items = await this.service.list(userId);
    return items;
  }

  // ── DELETE /api/memory ────────────────────────────────────────────────────
  // Clear all long-term memories for the current user.
  @Delete()
  async clear(@Headers('x-user-id') rawUserId: string) {
    const userId  = requireUserId(rawUserId);
    const deleted = await this.service.clear(userId);
    return { ok: true, deleted };
  }
}
