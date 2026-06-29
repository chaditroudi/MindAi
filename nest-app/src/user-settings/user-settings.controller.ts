import { Controller, Get, Post, Delete, Body, Headers, BadRequestException } from '@nestjs/common';
import { IsString, IsInt, IsOptional, Min, Max, MinLength, MaxLength } from 'class-validator';
import { UserSettingsService } from './user-settings.service';
import { requireUserId } from '../common/helpers/user-id';
import { fetchProviderModels, PROVIDERS } from '../ai/model';

class SaveSettingsDto {
  @IsString() @MinLength(1) @MaxLength(500)
  apiKey!: string;

  @IsString() @MinLength(1) @MaxLength(100)
  provider!: string;

  @IsString() @MinLength(1) @MaxLength(200)
  model!: string;

  @IsOptional() @IsInt() @Min(1) @Max(128_000)
  inputTokenLimit?: number;

  @IsOptional() @IsString() @MaxLength(200) supervisorModel?: string;
  @IsOptional() @IsString() @MaxLength(200) chartModel?:      string;
  @IsOptional() @IsString() @MaxLength(200) writerModel?:     string;
  @IsOptional() @IsString() @MaxLength(200) memoryModel?:     string;
}

@Controller('api/settings')
export class UserSettingsController {
  constructor(private readonly service: UserSettingsService) {}

  @Post('models')
  async listModels(@Body() body: { provider: string; apiKey: string }) {
    const provider = (body.provider ?? '').trim().toLowerCase();
    const apiKey   = (body.apiKey   ?? '').trim();
    if (!provider || !apiKey) throw new BadRequestException('provider and apiKey are required.');
    if (!PROVIDERS[provider])  throw new BadRequestException(`Unknown provider "${provider}".`);
    const models = await fetchProviderModels(provider, apiKey);
    return { models };
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
      inputTokenLimit:  settings.inputTokenLimit ?? 4_000,
      inputTokensUsed:  settings.inputTokensUsed  ?? 0,
      outputTokensUsed: settings.outputTokensUsed ?? 0,
      supervisorModel:  settings.supervisorModel,
      chartModel:       settings.chartModel,
      writerModel:      settings.writerModel,
      memoryModel:      settings.memoryModel,
    };
  }

  @Delete()
  async remove(@Headers('x-user-id') rawUserId: string) {
    const userId = requireUserId(rawUserId);
    await this.service.deleteByUser(userId);
    return { ok: true };
  }
}
