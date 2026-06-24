import {
  Controller, Post, Body, BadRequestException,
  HttpException, HttpStatus,
} from '@nestjs/common';
import { IsOptional, IsString, MinLength, MaxLength } from 'class-validator';

class VerifyKeyDto {
  @IsString() @MinLength(1) @MaxLength(500)
  apiKey!: string;

  /** Optional — auto-detected from key prefix when omitted. */
  @IsOptional() @IsString() @MaxLength(100)
  provider?: string;

  /** Optional — required only for unknown providers. */
  @IsOptional() @IsString() @MaxLength(500)
  verifyUrl?: string;
}

const KNOWN_PROVIDERS: Record<string, string> = {
  groq:      'https://api.groq.com/openai/v1/models',
  openai:    'https://api.openai.com/v1/models',
  anthropic: 'https://api.anthropic.com/v1/models',
  mistral:   'https://api.mistral.ai/v1/models',
  cohere:    'https://api.cohere.ai/v1/models',
  together:  'https://api.together.xyz/v1/models',
};

function autoDetect(key: string): { name: string; url: string } | null {
  if (key.startsWith('gsk_'))    return { name: 'Groq',      url: KNOWN_PROVIDERS['groq']! };
  if (key.startsWith('sk-ant-')) return { name: 'Anthropic', url: KNOWN_PROVIDERS['anthropic']! };
  if (key.startsWith('sk-'))     return { name: 'OpenAI',    url: KNOWN_PROVIDERS['openai']! };
  return null;
}

async function pingKey(apiKey: string, url: string): Promise<'valid' | 'invalid' | 'unreachable'> {
  try {
    const res = await fetch(url, {
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
  @Post('key')
  async verify(@Body() dto: VerifyKeyDto) {
    try {
      const key = dto.apiKey.trim();

      let name: string;
      let url: string;

      if (dto.verifyUrl?.trim()) {
        url  = dto.verifyUrl.trim();
        name = dto.provider?.trim() || 'Custom';
      } else {
        const detected = autoDetect(key);
        if (detected) {
          name = dto.provider?.trim() || detected.name;
          url  = detected.url;
        } else if (dto.provider?.trim()) {
          const providerKey = dto.provider.trim().toLowerCase();
          const known = KNOWN_PROVIDERS[providerKey];
          if (!known) {
            throw new BadRequestException(
              `Unknown provider "${dto.provider}". Pass a "verifyUrl" or use a Groq key (gsk_…) or OpenAI key (sk-…).`,
            );
          }
          name = dto.provider.trim();
          url  = known;
        } else {
          throw new BadRequestException(
            'Cannot detect provider from this key. Use a Groq key (gsk_…) or OpenAI key (sk-…).',
          );
        }
      }

      const status = await pingKey(key, url);

      if (status === 'invalid') {
        throw new BadRequestException(
          `This ${name} API key was rejected — it may be incorrect or revoked.`,
        );
      }
      if (status === 'unreachable') {
        throw new HttpException(
          { error: `Could not reach ${name} to verify the key. Please try again in a moment.` },
          HttpStatus.BAD_GATEWAY,
        );
      }

      return { ok: true, provider: name.toLowerCase() };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new HttpException(
        { error: err instanceof Error ? err.message : 'Unexpected error verifying key' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
