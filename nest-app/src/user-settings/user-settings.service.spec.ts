jest.mock('@mastra/core/agent', () => ({ Agent: class {} }));

import { BadRequestException, HttpException } from '@nestjs/common';
import { UserSettingsService } from './user-settings.service';
import type { UserSettingsRepository } from './user-settings.repository';

describe('UserSettingsService', () => {
  let repo: jest.Mocked<
    Pick<
      UserSettingsRepository,
      | 'save'
      | 'findByUser'
      | 'patchTokenLimit'
      | 'incrementUsage'
      | 'deleteByUser'
    >
  >;
  let service: UserSettingsService;
  const originalFetch = global.fetch;

  beforeEach(() => {
    repo = {
      save: jest.fn().mockResolvedValue(undefined),
      findByUser: jest.fn().mockResolvedValue(null),
      patchTokenLimit: jest.fn().mockResolvedValue(true),
      incrementUsage: jest.fn().mockResolvedValue(undefined),
      deleteByUser: jest.fn().mockResolvedValue(undefined),
    };
    service = new UserSettingsService(
      repo as unknown as UserSettingsRepository,
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('validate', () => {
    it('rejects an unknown provider without making a network call', async () => {
      const fetchSpy = jest.fn();
      global.fetch = fetchSpy;

      await expect(
        service.validate({
          apiKey: 'k',
          provider: 'not-a-provider',
          model: 'm',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('sanitizes provider/apiKey/model casing and whitespace on success', async () => {
      global.fetch = jest.fn().mockResolvedValue({ status: 200 });

      const result = await service.validate({
        apiKey: '  my-key  ',
        provider: '  OpenAI  ',
        model: '  gpt-5  ',
      });

      expect(result).toEqual({ ok: true, provider: 'openai', model: 'gpt-5' });
    });

    it('maps a network failure to a 502 Bad Gateway', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const err = await service
        .validate({ apiKey: 'k', provider: 'openai', model: 'm' })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(502);
    });

    it('rejects a key the provider reports as invalid (4xx, not 429)', async () => {
      global.fetch = jest.fn().mockResolvedValue({ status: 401 });

      await expect(
        service.validate({ apiKey: 'bad', provider: 'openai', model: 'm' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('treats 429 (rate-limited but valid key) as a pass', async () => {
      global.fetch = jest.fn().mockResolvedValue({ status: 429 });

      await expect(
        service.validate({ apiKey: 'k', provider: 'openai', model: 'm' }),
      ).resolves.toEqual({ ok: true, provider: 'openai', model: 'm' });
    });

    it('treats a 5xx provider error as ambiguous and allows the save', async () => {
      global.fetch = jest.fn().mockResolvedValue({ status: 503 });

      await expect(
        service.validate({ apiKey: 'k', provider: 'openai', model: 'm' }),
      ).resolves.toEqual({ ok: true, provider: 'openai', model: 'm' });
    });
  });

  describe('save', () => {
    it('normalizes responseTokenLimit/inputTokenLimit to the same value before persisting', async () => {
      global.fetch = jest.fn().mockResolvedValue({ status: 200 });

      await service.save('user-1', {
        apiKey: 'k',
        provider: 'openai',
        model: 'm',
        inputTokenLimit: 5_000,
      });

      expect(repo.save).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          responseTokenLimit: 5_000,
          inputTokenLimit: 5_000,
        }),
      );
    });

    it('does not persist when validation fails', async () => {
      await expect(
        service.save('user-1', {
          apiKey: 'k',
          provider: 'not-a-provider',
          model: 'm',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('usage tracking guard', () => {
    it('is a no-op when both token counts are non-positive', async () => {
      await service.incrementUsage('user-1', 0, 0);
      expect(repo.incrementUsage).not.toHaveBeenCalled();
    });

    it('forwards when at least one token count is positive', async () => {
      await service.incrementUsage('user-1', 0, 3);
      expect(repo.incrementUsage).toHaveBeenCalledWith('user-1', 0, 3);
    });
  });
});
