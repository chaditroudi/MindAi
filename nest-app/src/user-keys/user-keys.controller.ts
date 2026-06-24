import {
  Controller, Post, Body, BadRequestException, HttpException, HttpStatus,
} from '@nestjs/common';
import { IsString, IsUrl, MinLength, MaxLength } from 'class-validator';

type KeyStatus = 'valid' | 'invalid' | 'unreachable';

// Well-known providers the frontend can reference without sending a verifyUrl.
const KNOWN_PROVIDERS: Record<string, string> = {
  groq:      'https://api.groq.com/openai/v1/models',
  openai:    'https://api.openai.com/v1/models',
  anthropic: 'https://api.anthropic.com/v1/models',
  mistral:   'https://api.mistral.ai/v1/models',
  cohere:    'https://api.cohere.ai/v1/models',
  together:  'https://api.together.xyz/v1/models',
};

class VerifyKeyDto {
  @IsString() @MinLength(1) @MaxLength(500)
  apiKey!: string;

  /** Human-readable label returned in the response (e.g. "Groq", "My Provider"). */
  @IsString() @MinLength(1) @MaxLength(100)
  provider!: string;

  /**
   * URL of the provider's model-list (or any authenticated endpoint).
   * Optional when `provider` matches a known provider name (case-insensitive).
   */
  @IsUrl() @MaxLength(500)
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
    const key  = dto.apiKey.trim();
    const name = dto.provider.trim();

    const url =
      dto.verifyUrl?.trim() ??
      KNOWN_PROVIDERS[name.toLowerCase()];

    if (!url) {
      throw new BadRequestException(
        `No verification URL known for provider "${name}". ` +
        `Pass a "verifyUrl" field pointing to an authenticated endpoint (e.g. a models list).`,
      );
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

    return { ok: true, provider: name };
  }
}
