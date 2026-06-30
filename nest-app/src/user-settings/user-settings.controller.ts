import { Controller, Get, Post, Patch, Delete, Body, Headers, BadRequestException } from '@nestjs/common';
import { IsString, IsInt, IsOptional, Min, Max, MinLength, MaxLength } from 'class-validator';
import { UserSettingsService } from './user-settings.service';
import { requireUserId } from '../common/helpers/user-id';
import { PROVIDERS, PROVIDER_MODELS } from '../ai/model';

class SaveSettingsDto {
  @IsString() @MinLength(1) @MaxLength(500)
  apiKey!: string;

  @IsString() @MinLength(1) @MaxLength(100)
  provider!: string;

  @IsString() @MinLength(1) @MaxLength(200)
  model!: string;

  @IsOptional() @IsInt() @Min(1) @Max(128_000)
  responseTokenLimit?: number;

  @IsOptional() @IsInt() @Min(1) @Max(128_000)
  inputTokenLimit?: number;
}

@Controller('api/settings')
export class UserSettingsController {
  constructor(private readonly service: UserSettingsService) {}

  @Post('models')
  listModels(@Body() body: { provider: string }) {
    const provider = (body.provider ?? '').trim().toLowerCase();
    if (!provider)            throw new BadRequestException('provider is required.');
    if (!PROVIDERS[provider]) throw new BadRequestException(`Unknown provider "${provider}".`);
    return { models: PROVIDER_MODELS[provider] ?? [] };
  }

  @Post('validate')
  async validate(@Body() dto: SaveSettingsDto) {
    return this.service.validate(dto);
  }

  @Post()
  async save(
    @Body() dto: SaveSettingsDto,
    @Headers('x-user-id') rawUserId: string,
  ) {
    const userId = requireUserId(rawUserId);
    return this.service.save(userId, dto);
  }

  @Get()
  async get(@Headers('x-user-id') rawUserId: string) {
    const userId   = requireUserId(rawUserId);
    const settings = await this.service.findByUser(userId);
    if (!settings) return { configured: false };
    return {
      configured:       true,
      provider:         settings.provider,
      model:            settings.model,
      keyPreview:       `${settings.apiKey.slice(0, 6)}...${settings.apiKey.slice(-4)}`,
      responseTokenLimit: settings.responseTokenLimit ?? settings.inputTokenLimit ?? 4_000,
      inputTokenLimit:    settings.responseTokenLimit ?? settings.inputTokenLimit ?? 4_000,
      inputTokensUsed:  settings.inputTokensUsed  ?? 0,
      outputTokensUsed: settings.outputTokensUsed ?? 0,
    };
  }

  @Patch('token-limit')
  async patchTokenLimit(
    @Body() body: { responseTokenLimit?: number; inputTokenLimit?: number },
    @Headers('x-user-id') rawUserId: string,
  ) {
    const userId = requireUserId(rawUserId);
    const limit  = Number(body.responseTokenLimit ?? body.inputTokenLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 128_000) {
      throw new BadRequestException('responseTokenLimit must be an integer between 1 and 128000.');
    }
    return this.service.patchTokenLimit(userId, limit);
  }

  @Delete()
  async remove(@Headers('x-user-id') rawUserId: string) {
    const userId = requireUserId(rawUserId);
    await this.service.deleteByUser(userId);
    return { ok: true };
  }
}
