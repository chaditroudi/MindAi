/* eslint-disable @typescript-eslint/no-require-imports --
   jest.mock() calls below aren't hoisted by ts-jest the way babel-jest hoists
   them, so the module under test must be pulled in via a runtime require()
   placed after the mocks — an ES import would be hoisted above them by the
   TS compiler's CommonJS emit and load the real (unmocked) module first. */

// model.ts imports Agent from @mastra/core/agent at the top of the file,
// which pulls in an ESM-only dependency ts-jest can't parse under
// node_modules — regardless of which exported function is actually under
// test. Stub the package out; createSkillAgent isn't exercised here.
export {}; // force module scope so top-level consts don't collide across spec files

jest.mock('@mastra/core/agent', () => ({ Agent: class {} }));

const {
  buildProviderValidationRequest,
  fetchProviderModels,
  withRateLimitRetry,
  freshSignal,
  skillProviderOptions,
} = require('./model') as typeof import('./model');

describe('buildProviderValidationRequest', () => {
  it('returns null for an unrecognized provider', () => {
    expect(buildProviderValidationRequest('not-a-provider', 'key')).toBeNull();
  });

  it('builds a google request with the x-goog-api-key header', () => {
    const req = buildProviderValidationRequest('google', 'my-key');
    expect(req).toEqual({
      url: 'https://generativelanguage.googleapis.com/v1beta/models',
      headers: { 'x-goog-api-key': 'my-key' },
    });
  });

  it('builds an anthropic request with the anthropic-version and x-api-key headers', () => {
    const req = buildProviderValidationRequest('anthropic', 'my-key');
    expect(req).toEqual({
      url: 'https://api.anthropic.com/v1/models',
      headers: { 'anthropic-version': '2023-06-01', 'x-api-key': 'my-key' },
    });
  });

  it('builds a bearer-auth request for OpenAI-compatible providers', () => {
    const req = buildProviderValidationRequest('groq', 'my-key');
    expect(req).toEqual({
      url: 'https://api.groq.com/openai/v1/models',
      headers: { Authorization: 'Bearer my-key' },
    });
  });

  it('normalizes provider casing/whitespace', () => {
    const req = buildProviderValidationRequest('  OpenAI  ', 'my-key');
    expect(req?.url).toBe('https://api.openai.com/v1/models');
  });
});

describe('fetchProviderModels', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns [] for an unrecognized provider without calling fetch', async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy;

    const models = await fetchProviderModels('nope', 'key');

    expect(models).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws when the provider responds with a non-ok status', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => ({}),
    });

    await expect(fetchProviderModels('openai', 'bad-key')).rejects.toThrow(
      /401/,
    );
  });

  it('parses and filters the Google model list to generateContent-capable models', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => ({
        models: [
          {
            name: 'models/gemini-2.5-pro',
            displayName: 'Gemini 2.5 Pro',
            supportedGenerationMethods: ['generateContent'],
          },
          {
            name: 'models/embedding-001',
            supportedGenerationMethods: ['embedContent'],
          },
        ],
      }),
    });

    const models = await fetchProviderModels('google', 'key');

    expect(models).toEqual([{ id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' }]);
  });

  it('parses the Anthropic model list, falling back to id when display_name is absent', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => ({
        data: [
          { id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6' },
          { id: 'claude-legacy' },
        ],
      }),
    });

    const models = await fetchProviderModels('anthropic', 'key');

    expect(models).toEqual([
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { id: 'claude-legacy', label: 'claude-legacy' },
    ]);
  });

  it('parses OpenAI-compatible model lists and sorts them by id', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => ({
        data: [{ id: 'zeta-model' }, { id: 'alpha-model' }],
      }),
    });

    const models = await fetchProviderModels('groq', 'key');

    expect(models).toEqual([
      { id: 'alpha-model', label: 'alpha-model' },
      { id: 'zeta-model', label: 'zeta-model' },
    ]);
  });
});

describe('withRateLimitRetry', () => {
  it('returns the result immediately when fn succeeds on the first try', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRateLimitRetry(fn, 'test');
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('rethrows non-rate-limit errors without retrying', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(withRateLimitRetry(fn, 'test')).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a 429 and succeeds on the next attempt', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('rate limited'), {
          statusCode: 429,
          responseHeaders: { 'retry-after': '0.01' },
        }),
      )
      .mockResolvedValueOnce('ok');

    const result = await withRateLimitRetry(fn, 'test', 1);

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('gives up after exhausting maxRetries and throws the last error', async () => {
    const err = Object.assign(new Error('rate limited'), {
      statusCode: 429,
      responseHeaders: { 'retry-after': '0.01' },
    });
    const fn = jest.fn().mockRejectedValue(err);

    await expect(withRateLimitRetry(fn, 'test', 1)).rejects.toThrow(
      'rate limited',
    );
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('surfaces immediately (no retry) when the provider signals a long-term quota exhaustion', async () => {
    const err = Object.assign(new Error('daily quota exhausted'), {
      statusCode: 429,
      responseHeaders: { 'x-should-retry': 'false' },
    });
    const fn = jest.fn().mockRejectedValue(err);

    await expect(withRateLimitRetry(fn, 'test', 3)).rejects.toThrow(
      'daily quota exhausted',
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('freshSignal', () => {
  it('returns undefined when no timeout is given', () => {
    expect(freshSignal('writer')).toBeUndefined();
  });

  it('returns undefined for a non-finite or non-positive timeout', () => {
    expect(freshSignal('writer', 0)).toBeUndefined();
    expect(freshSignal('writer', -5)).toBeUndefined();
    expect(freshSignal('writer', NaN)).toBeUndefined();
  });

  it('returns an AbortSignal for a positive timeout', () => {
    expect(freshSignal('writer', 5_000)).toBeInstanceOf(AbortSignal);
  });
});

describe('skillProviderOptions', () => {
  it('returns undefined when the provider cannot be determined', () => {
    expect(skillProviderOptions(undefined, undefined)).toBeUndefined();
  });

  it('disables structured outputs for groq', () => {
    expect(skillProviderOptions('any-key', 'groq')).toEqual({
      groq: { structuredOutputs: false },
    });
  });

  it('forces systemMessageMode:"system" for mistral/together/perplexity', () => {
    expect(skillProviderOptions('any-key', 'mistral')).toEqual({
      openai: { systemMessageMode: 'system' },
    });
  });

  it('detects the provider from the API key prefix when none is given explicitly', () => {
    expect(skillProviderOptions('gsk_abc', undefined)).toEqual({
      groq: { structuredOutputs: false },
    });
  });

  it('returns undefined for providers needing no special options (e.g. openai)', () => {
    expect(skillProviderOptions('sk-abc', 'openai')).toBeUndefined();
  });
});
