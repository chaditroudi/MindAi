import { Injectable, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { UserSettingsRepository } from './user-settings.repository';
import type { UserSettingsDocument } from './user-settings.repository';
import { buildProviderValidationRequest, detectProviderFromApiKey, PROVIDERS } from '../ai/model';

export interface UserSettingsDto {
  apiKey:           string;
  provider:         string;
  model:            string;
  inputTokenLimit?: number;
}

export interface ValidationResult {
  ok:       boolean;
  provider: string;
  model:    string;
}

const TIMEOUT_MS = 8_000;

// ── Generic validator ──────────────────────────────────────────────────────────
// Uses the PROVIDERS registry from model.ts — same baseURL, no duplication.
// Every provider that exposes GET /models (all OpenAI-compatible ones) works here.

async function validateApiKey(apiKey: string, provider: string): Promise<void> {
  const request = buildProviderValidationRequest(provider, apiKey);
  if (!request) return; // unknown provider → skip, first real request surfaces errors

  let res: Response;
  try {
    res = await fetch(request.url, {
      headers: request.headers,
      signal:  AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new HttpException(
      `Cannot reach ${provider}. Check your network connection.`,
      HttpStatus.BAD_GATEWAY,
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new BadRequestException(`Invalid ${provider} API key.`);
  }
  // 429 = rate-limited but key is valid → allow save
  // other non-OK = provider endpoint temporarily down → don't block save
}

function sanitizeSettings(dto: UserSettingsDto): UserSettingsDto {
  return {
    apiKey:           dto.apiKey.trim(),
    provider:         dto.provider.trim().toLowerCase(),
    model:            dto.model.trim(),
    inputTokenLimit:  dto.inputTokenLimit,
  };
}

// ── Service ────────────────────────────────────────────────────────────────────

@Injectable()
export class UserSettingsService {
  constructor(private readonly repo: UserSettingsRepository) {}

  async validate(dto: UserSettingsDto): Promise<ValidationResult> {
    const { apiKey, provider, model } = sanitizeSettings(dto);
    const providerKey = provider;
    // Resolve effective provider: use the user's string if it's in the registry,
    // otherwise auto-detect from the API key prefix (AIza→google, sk-ant-→anthropic, etc.)
    const effective = PROVIDERS[providerKey]
      ? providerKey
      : (detectProviderFromApiKey(apiKey) ?? providerKey);
    await validateApiKey(apiKey, effective);
    return { ok: true, provider: providerKey, model };
  }

  async save(userId: string, dto: UserSettingsDto): Promise<ValidationResult> {
    const clean = sanitizeSettings(dto);
    const result = await this.validate(clean);
    await this.repo.save(userId, clean);
    return result;
  }

  async findByUser(userId: string): Promise<UserSettingsDocument | null> {
    return this.repo.findByUser(userId);
  }

  async incrementUsage(userId: string, inputTokens: number, outputTokens: number): Promise<void> {
    if (inputTokens <= 0 && outputTokens <= 0) return;
    await this.repo.incrementUsage(userId, inputTokens, outputTokens);
  }

  async deleteByUser(userId: string): Promise<void> {
    await this.repo.deleteByUser(userId);
  }
}
