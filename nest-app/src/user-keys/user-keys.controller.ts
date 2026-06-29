import {
  Controller, Post, Body, BadRequestException,
  HttpException, HttpStatus,
} from '@nestjs/common';
import { IsOptional, IsString, MinLength, MaxLength } from 'class-validator';
import { PROVIDERS, buildProviderValidationRequest, detectProviderFromApiKey } from '../ai/model';

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

// Build /models URL map from the shared PROVIDERS registry (single source of truth).
const MODEL_URLS: Record<string, string> = Object.fromEntries(
  Object.entries(PROVIDERS).map(([name, base]) => [name, `${base}/models`]),
);

// Allowlist for verifyUrl — prevents SSRF by restricting to known provider endpoints.
const ALLOWED_VERIFY_URLS = new Set(Object.values(MODEL_URLS));

function autoDetect(key: string): { name: string; url: string } | null {
  const provider = detectProviderFromApiKey(key);
  if (!provider) return null;
  const url = MODEL_URLS[provider];
  return url ? { name: provider, url } : null;
}

async function pingKey(apiKey: string, provider: string, url: string): Promise<'valid' | 'invalid' | 'unreachable'> {
  const request = buildProviderValidationRequest(provider, apiKey);
  const headers = request?.headers ?? { Authorization: `Bearer ${apiKey}` };
  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(8_000),
    });
    if (res.status === 200 || res.status === 429) return 'valid'; // 429 = rate-limited but key is valid
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
        const candidate = dto.verifyUrl.trim();
        if (!ALLOWED_VERIFY_URLS.has(candidate)) {
          throw new BadRequestException('verifyUrl must be one of the known provider model endpoints.');
        }
        url  = candidate;
        name = dto.provider?.trim() || 'custom';
      } else {
        const detected = autoDetect(key);
        if (detected) {
          name = dto.provider?.trim() || detected.name;
          url  = detected.url;
        } else if (dto.provider?.trim()) {
          const providerKey = dto.provider.trim().toLowerCase();
          const known = MODEL_URLS[providerKey];
          if (!known) {
            throw new BadRequestException(
              `Unknown provider "${dto.provider}". Supported: ${Object.keys(PROVIDERS).join(', ')}.`,
            );
          }
          name = providerKey;
          url  = known;
        } else {
          throw new BadRequestException(
            'Cannot detect provider from this key prefix. Please select a provider explicitly.',
          );
        }
      }

      const status = await pingKey(key, name, url);

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
