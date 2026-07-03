/* eslint-disable @typescript-eslint/no-require-imports --
   jest.mock() calls below aren't hoisted by ts-jest the way babel-jest hoists
   them, so the module under test must be pulled in via a runtime require()
   placed after the mocks — an ES import would be hoisted above them by the
   TS compiler's CommonJS emit and load the real (unmocked) module first. */

// writer.ts imports createSkillAgent/withRateLimitRetry from ./model, which
// pulls in @mastra/core/agent -> an ESM-only dependency ts-jest can't parse
// under node_modules. Stub the module out; these tests only assert on how
// writer.ts *calls* it, not its real behavior.
interface GenerateResult {
  object: unknown;
  usage: { inputTokens?: number; outputTokens?: number };
}

const generate = jest.fn<Promise<GenerateResult>, [unknown, unknown]>();
const createSkillAgent = jest.fn().mockReturnValue({ generate });
const withRateLimitRetry = jest.fn(
  (fn: () => unknown, label: string) => (void label, fn()),
);
const freshSignal = jest.fn().mockReturnValue(undefined);
const skillProviderOptions = jest.fn().mockReturnValue({});
const buildInquiryMessage = jest.fn().mockReturnValue('inquiry message');
const buildReportMessage = jest.fn().mockReturnValue('report message');

/* eslint-disable @typescript-eslint/no-unsafe-return --
   createSkillAgent's return type (Agent) and skillProviderOptions' own real
   return type (declared `any` in model.ts) make these mock pass-throughs
   unavoidably untyped — this file only ever exercises the mocks. */
jest.mock('./model', () => ({
  createSkillAgent: (
    ...args: Parameters<typeof import('./model').createSkillAgent>
  ) => createSkillAgent(...args),
  withRateLimitRetry: (fn: () => unknown, label: string) =>
    withRateLimitRetry(fn, label),
  freshSignal: (label?: string) => freshSignal(label),
  skillProviderOptions: (apiKey?: string, provider?: string) =>
    skillProviderOptions(apiKey, provider),
}));
jest.mock('../prompts', () => ({
  buildInquiryMessage: (...args: unknown[]) => buildInquiryMessage(...args),
  buildReportMessage: (...args: unknown[]) => buildReportMessage(...args),
}));
/* eslint-enable @typescript-eslint/no-unsafe-return */

const { runInquirySkill, runReportSkill } =
  require('./writer') as typeof import('./writer');

describe('runInquirySkill', () => {
  beforeEach(() => {
    generate.mockReset().mockResolvedValue({
      object: { summary: 'ok' },
      usage: { inputTokens: 5, outputTokens: 7 },
    });
    buildInquiryMessage.mockClear();
  });

  it('builds the inquiry message from prompt/rows with the configured row and char limits', async () => {
    const rows = [{ a: 1 }, { a: 2 }];
    await runInquirySkill({ prompt: 'summarize', rows });

    expect(buildInquiryMessage).toHaveBeenCalledWith(
      'summarize',
      rows,
      expect.any(Number),
      expect.any(Number),
    );
  });

  it('uses the caller-supplied maxTokens instead of the env default when provided', async () => {
    await runInquirySkill({ prompt: 'x', rows: [], maxTokens: 123 });

    const options = generate.mock.calls[0][1] as {
      modelSettings: { maxOutputTokens: number };
    };
    expect(options.modelSettings.maxOutputTokens).toBe(123);
  });

  it('defaults missing usage fields to 0', async () => {
    generate.mockResolvedValue({ object: { summary: 'ok' }, usage: {} });

    const { usage } = await runInquirySkill({ prompt: 'x', rows: [] });

    expect(usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('returns the parsed summary object', async () => {
    const { result } = await runInquirySkill({ prompt: 'x', rows: [] });
    expect(result).toEqual({ summary: 'ok' });
  });
});

describe('runReportSkill', () => {
  beforeEach(() => {
    generate.mockReset().mockResolvedValue({
      object: { reportSections: [{ heading: 'H', body: 'B' }] },
      usage: { inputTokens: 5, outputTokens: 7 },
    });
    buildReportMessage.mockClear();
  });

  it('passes withChart through to buildReportMessage', async () => {
    await runReportSkill({ prompt: 'x', rows: [], withChart: true });

    expect(buildReportMessage).toHaveBeenCalledWith(
      'x',
      [],
      expect.any(Number),
      true,
    );
  });

  it('defaults withChart to undefined when not provided', async () => {
    await runReportSkill({ prompt: 'x', rows: [] });

    expect(buildReportMessage).toHaveBeenCalledWith(
      'x',
      [],
      expect.any(Number),
      undefined,
    );
  });

  it('uses the caller-supplied maxTokens instead of the env default when provided', async () => {
    await runReportSkill({ prompt: 'x', rows: [], maxTokens: 321 });

    const options = generate.mock.calls[0][1] as {
      modelSettings: { maxOutputTokens: number };
    };
    expect(options.modelSettings.maxOutputTokens).toBe(321);
  });

  it('defaults missing usage fields to 0', async () => {
    generate.mockResolvedValue({
      object: { reportSections: [{ heading: 'H', body: 'B' }] },
      usage: {},
    });

    const { usage } = await runReportSkill({ prompt: 'x', rows: [] });

    expect(usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('returns the parsed report sections', async () => {
    const { result } = await runReportSkill({ prompt: 'x', rows: [] });
    expect(result).toEqual({
      reportSections: [{ heading: 'H', body: 'B' }],
    });
  });
});
