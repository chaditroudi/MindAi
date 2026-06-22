import {
  Controller, Get, Post, Delete, Param, Body,
  NotFoundException, BadRequestException, HttpException, HttpStatus,
} from '@nestjs/common';
import { IsString, MinLength, MaxLength } from 'class-validator';
import { UserKeysService } from './user-keys.service';

class SaveKeyDto {
  @IsString() @MinLength(1) @MaxLength(200) userId!: string;
  @IsString() @MinLength(1) @MaxLength(300) apiKey!: string;
}

type Provider  = 'groq' | 'openai';
type KeyStatus = 'valid' | 'invalid' | 'unreachable';

const PROVIDER_VERIFY_URLS: Record<Provider, string> = {
  groq:   'https://api.groq.com/openai/v1/models',
  openai: 'https://api.openai.com/v1/models',
};

const PROVIDER_NAMES: Record<Provider, string> = {
  groq:   'Groq',
  openai: 'OpenAI',
};

function detectProvider(key: string): Provider | null {
  if (key.startsWith('gsk_')) return 'groq';
  if (key.startsWith('sk-'))  return 'openai';
  return null;
}

async function verifyKey(apiKey: string, provider: Provider): Promise<KeyStatus> {
  try {
    const res = await fetch(PROVIDER_VERIFY_URLS[provider], {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal:  AbortSignal.timeout(8_000),
    });
    if (res.status === 200) return 'valid';
    if (res.status === 401 || res.status === 403) return 'invalid';
    return 'unreachable';
  } catch {
    return 'unreachable';
  }
}

@Controller('api')
export class UserKeysController {
  constructor(private readonly service: UserKeysService) {}

  @Get('key/:userId')
  async get(@Param('userId') userId: string) {
    const apiKey = await this.service.get(userId);
    if (!apiKey) throw new NotFoundException('No API key found for this user.');
    return { ok: true, hasKey: true };
  }

  @Post('key')
  async save(@Body() dto: SaveKeyDto) {
    if (!dto.userId || !dto.apiKey) throw new BadRequestException('userId and apiKey are required');
    const key = dto.apiKey.trim();

    const provider = detectProvider(key);
    if (!provider) {
      throw new BadRequestException(
        'Unrecognised key format. Use a Groq key (starts with "gsk_") or an OpenAI key (starts with "sk-").',
      );
    }

    const status = await verifyKey(key, provider);

    if (status === 'invalid') {
      throw new BadRequestException(
        `This ${PROVIDER_NAMES[provider]} API key was rejected — it may be incorrect or revoked. Please check it and try again.`,
      );
    }
    if (status === 'unreachable') {
      throw new HttpException(
        { error: `Could not reach ${PROVIDER_NAMES[provider]} to verify the key. Please try again in a moment.` },
        HttpStatus.BAD_GATEWAY,
      );
    }

    await this.service.save(dto.userId, key);
    return { ok: true, provider };
  }

  @Delete('key/:userId')
  async remove(@Param('userId') userId: string) {
    await this.service.delete(userId);
    return { ok: true };
  }
}
