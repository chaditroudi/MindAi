import { Injectable, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { UserSettingsRepository } from './user-settings.repository';
import type { UserSettingsDocument } from './user-settings.repository';

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

// ── Per-provider validation ────────────────────────────────────────────────────

async function validateGroq(apiKey: string, model: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal:  AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new HttpException('Cannot reach Groq. Check your network connection.', HttpStatus.BAD_GATEWAY);
  }
  if (res.status === 401 || res.status === 403) {
    throw new BadRequestException('Invalid Groq API key. Get yours at console.groq.com/keys');
  }
  if (!res.ok) {
    throw new HttpException(`Groq returned ${res.status}. Try again later.`, HttpStatus.BAD_GATEWAY);
  }
  const body = await res.json() as { data: { id: string }[] };
  const ids  = body.data?.map(m => m.id) ?? [];
  if (ids.length && !ids.includes(model)) {
    throw new BadRequestException(
      `Model "${model}" not found on Groq. Available: ${ids.slice(0, 5).join(', ')}…`,
    );
  }
}

async function validateOpenAI(apiKey: string, model: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal:  AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new HttpException('Cannot reach OpenAI. Check your network connection.', HttpStatus.BAD_GATEWAY);
  }
  if (res.status === 401 || res.status === 403) {
    throw new BadRequestException('Invalid OpenAI API key. Get yours at platform.openai.com/api-keys');
  }
  if (!res.ok) {
    throw new HttpException(`OpenAI returned ${res.status}. Try again later.`, HttpStatus.BAD_GATEWAY);
  }
  const body = await res.json() as { data: { id: string }[] };
  const ids  = body.data?.map(m => m.id) ?? [];
  if (ids.length && !ids.includes(model)) {
    throw new BadRequestException(
      `Model "${model}" not available on your OpenAI account.`,
    );
  }
}

async function validateAnthropic(apiKey: string, model: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new HttpException('Cannot reach Anthropic. Check your network connection.', HttpStatus.BAD_GATEWAY);
  }
  if (res.status === 401 || res.status === 403) {
    throw new BadRequestException('Invalid Anthropic API key. Get yours at console.anthropic.com');
  }
  if (!res.ok) {
    throw new HttpException(`Anthropic returned ${res.status}. Try again later.`, HttpStatus.BAD_GATEWAY);
  }
  const body = await res.json() as { data: { id: string }[] };
  const ids  = body.data?.map(m => m.id) ?? [];
  if (ids.length && !ids.includes(model)) {
    throw new BadRequestException(
      `Model "${model}" not found on Anthropic. Check the model ID.`,
    );
  }
}

async function validateGoogle(apiKey: string, model: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      headers: { 'x-goog-api-key': apiKey },
      signal:  AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new HttpException('Cannot reach Google AI. Check your network connection.', HttpStatus.BAD_GATEWAY);
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    throw new BadRequestException('Invalid Google AI API key. Get yours at aistudio.google.com/apikey');
  }
  if (!res.ok) {
    throw new HttpException(`Google AI returned ${res.status}. Try again later.`, HttpStatus.BAD_GATEWAY);
  }
  const body  = await res.json() as { models: { name: string }[] };
  const names = body.models?.map(m => m.name.split('/').pop() ?? m.name) ?? [];
  if (names.length && !names.includes(model)) {
    throw new BadRequestException(
      `Model "${model}" not found on Google AI. Check the model ID.`,
    );
  }
}

// ── Main service ───────────────────────────────────────────────────────────────

@Injectable()
export class UserSettingsService {
  constructor(private readonly repo: UserSettingsRepository) {}

  async validate(dto: UserSettingsDto): Promise<ValidationResult> {
    const { apiKey, provider, model } = dto;

    switch (provider) {
      case 'groq':      await validateGroq(apiKey, model);      break;
      case 'openai':    await validateOpenAI(apiKey, model);    break;
      case 'anthropic': await validateAnthropic(apiKey, model); break;
      case 'google':    await validateGoogle(apiKey, model);    break;
      default:
        throw new BadRequestException(`Unknown provider "${provider}"`);
    }

    return { ok: true, provider, model };
  }

  async save(userId: string, dto: UserSettingsDto): Promise<void> {
    await this.validate(dto);
    await this.repo.save(userId, dto);
  }

  async findByUser(userId: string): Promise<UserSettingsDocument | null> {
    return this.repo.findByUser(userId);
  }

  async deleteByUser(userId: string): Promise<void> {
    await this.repo.deleteByUser(userId);
  }
}
