import { Injectable, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { UserSettingsRepository } from './user-settings.repository';
import type { UserSettingsDocument } from './user-settings.repository';
import { detectProvider, PROVIDERS } from '../ai/model';

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
  const baseURL = PROVIDERS[provider];
  if (!baseURL) return; // unknown provider → skip, first real request surfaces errors

  let res: Response;
  try {
    res = await fetch(`${baseURL}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
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

// ── Service ────────────────────────────────────────────────────────────────────

@Injectable()
export class UserSettingsService {
  constructor(private readonly repo: UserSettingsRepository) {}

  async validate(dto: UserSettingsDto): Promise<ValidationResult> {
    const { apiKey, provider, model } = dto;
    // Resolve effective provider: use the user's string if it's in the registry,
    // otherwise auto-detect from the API key prefix (AIza→google, sk-ant-→anthropic, etc.)
    const effective = PROVIDERS[provider] ? provider : detectProvider(apiKey);
    await validateApiKey(apiKey, effective);
    return { ok: true, provider, model };
  }

  async save(userId: string, dto: UserSettingsDto): Promise<void> {
    await this.validate(dto);
    await this.repo.save(userId, dto);
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
