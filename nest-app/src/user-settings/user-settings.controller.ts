import { Controller, Get, Post, Delete, Body, Headers, UnauthorizedException } from '@nestjs/common';
import { IsString, MinLength, MaxLength } from 'class-validator';
import { UserSettingsService } from './user-settings.service';

class SaveSettingsDto {
  @IsString() @MinLength(1) @MaxLength(500)
  apiKey!: string;

  @IsString() @MinLength(1) @MaxLength(100)
  provider!: string;

  @IsString() @MinLength(1) @MaxLength(200)
  model!: string;
}

function requireUserId(raw: string | undefined): string {
  const id = raw?.trim();
  if (!id) throw new UnauthorizedException('User ID missing.');
  return id;
}

@Controller('api/settings')
export class UserSettingsController {
  constructor(private readonly service: UserSettingsService) {}

  @Post()
  async save(
    @Body() dto: SaveSettingsDto,
    @Headers('x-user-id') rawUserId: string,
  ) {
    const userId = requireUserId(rawUserId);
    await this.service.save(userId, dto);
    return { ok: true };
  }

  @Get()
  async get(@Headers('x-user-id') rawUserId: string) {
    const userId   = requireUserId(rawUserId);
    const settings = await this.service.findByUser(userId);
    if (!settings) return { configured: false };
    return {
      configured: true,
      provider:   settings.provider,
      model:      settings.model,
      keyPreview: `${settings.apiKey.slice(0, 6)}...${settings.apiKey.slice(-4)}`,
    };
  }

  @Delete()
  async remove(@Headers('x-user-id') rawUserId: string) {
    const userId = requireUserId(rawUserId);
    await this.service.deleteByUser(userId);
    return { ok: true };
  }
}
