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

type GroqKeyStatus = 'valid' | 'invalid' | 'unreachable';

async function verifyGroqKey(apiKey: string): Promise<GroqKeyStatus> {
  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
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

    if (!key.startsWith('gsk_')) {
      throw new BadRequestException(
        'Invalid Groq API key format. Keys must start with "gsk_". Get yours at console.groq.com',
      );
    }

    const status = await verifyGroqKey(key);

    if (status === 'invalid') {
      throw new BadRequestException(
        'This Groq API key was rejected — it may be incorrect or revoked. Please check it and try again.',
      );
    }
    if (status === 'unreachable') {
      throw new HttpException(
        { error: 'Could not reach Groq to verify the key. Please try again in a moment.' },
        HttpStatus.BAD_GATEWAY,
      );
    }

    await this.service.save(dto.userId, key);
    return { ok: true };
  }

  @Delete('key/:userId')
  async remove(@Param('userId') userId: string) {
    await this.service.delete(userId);
    return { ok: true };
  }
}
