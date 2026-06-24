import {
  Controller, Post, Body, BadRequestException, HttpException, HttpStatus,
} from '@nestjs/common';
import { IsOptional, IsString, IsUrl, MinLength, MaxLength } from 'class-validator';

type KeyStatus = 'valid' | 'invalid' | 'unreachable';

const KNOWN_PROVIDERS: Record<string, string> = {
  groq:      'https://api.groq.com/openai/v1/models',
  openai:    'https://api.openai.com/v1/models',
  anthropic: 'https://api.anthropic.com/v1/models',
  mistral:   'https://api.mistral.ai/v1/models',
  cohere:    'https://api.cohere.ai/v1/models',
  together:  'https://api.together.xyz/v1/models',
};

function autoDetect(key: string): { name: string; url: string } | null {
  if (key.startsWith('gsk_'))    return { name: 'Groq',      url: KNOWN_PROVIDERS['groq'] };
  if (key.startsWith('sk-ant-')) return { name: 'Anthropic', url: KNOWN_PROVIDERS['anthropic'] };
  if (key.startsWith('sk-'))     return { name: 'OpenAI',    url: KNOWN_PROVIDERS['openai'] };
  return null;
}

class VerifyKeyDto {
  @IsString() @MinLength(1) @MaxLength(500)
  apiKey!: string;

  /** Optional — auto-detected from key prefix (gsk_ = Groq, sk- = OpenAI, etc.). */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100)
  provider?: string;

  /** Required only when provider is unknown and not in the built-in list. */
  @IsOptional() @IsUrl() @MaxLength(500)
  verifyUrl?: string;
}

async function pingKey(apiKey: string, url: string): Promise<KeyStatus> {
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
    const key = dto.apiKey.trim();

    // Resolve provider name + verify URL
    let name: string;
    let url:  string;

    if (dto.verifyUrl) {
      name = dto.provider?.trim() || 'Custom';
      url  = dto.verifyUrl.trim();
    } else {
      const detected = autoDetect(key);
      if (detected) {
        name = dto.provider?.trim() || detected.name;
        url  = detected.url;
      } else if (dto.provider) {
        const known = KNOWN_PROVIDERS[dto.provider.toLowerCase()];
        if (!known) {
          throw new BadRequestException(
            `Unknown provider "${dto.provider}". Pass a "verifyUrl" or use a key starting with gsk_ (Groq) or sk- (OpenAI).`,
          );
        }
        name = dto.provider;
        url  = known;
      } else {
        throw new BadRequestException(
          'Cannot detect provider from this key format. Use a Groq key (gsk_…) or OpenAI key (sk-…), or pass "provider" + "verifyUrl".',
        );
      }
    }

    const status = await pingKey(key, url);

    if (status === 'invalid') {
      throw new BadRequestException(
        `This ${name} API key was rejected — it may be incorrect or revoked. Please check it and try again.`,
      );
    }
    if (status === 'unreachable') {
      throw new HttpException(
        { error: `Could not reach ${name} to verify the key. Please try again in a moment.` },
        HttpStatus.BAD_GATEWAY,
      );
    }

    return { ok: true, provider: name.toLowerCase() };
  }
}
