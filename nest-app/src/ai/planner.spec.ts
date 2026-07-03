/* eslint-disable @typescript-eslint/no-require-imports --
   jest.mock() calls below aren't hoisted by ts-jest the way babel-jest hoists
   them, so the module under test must be pulled in via a runtime require()
   placed after the mocks — an ES import would be hoisted above them by the
   TS compiler's CommonJS emit and load the real (unmocked) module first. */
import type { DataSource, TaskPlan, ExecutionSkillKind } from '../types';

// planner.ts imports createSkillAgent/withRateLimitRetry from ./model,
// which pulls in @mastra/core/agent -> an ESM-only dependency ts-jest can't
// parse under node_modules. Stub the module out; runSupervisorPlan tests
// below only assert on how planner.ts *calls* these, not their real behavior.
const generate = jest.fn();
const createSkillAgent = jest.fn().mockReturnValue({ generate });
const withRateLimitRetry = jest.fn((fn: () => unknown) => fn());
const freshSignal = jest.fn().mockReturnValue(undefined);
const skillProviderOptions = jest.fn().mockReturnValue({});

jest.mock('./model', () => ({
  createSkillAgent: (...args: unknown[]) => createSkillAgent(...args),
  withRateLimitRetry: (...args: unknown[]) => withRateLimitRetry(...args),
  freshSignal: (...args: unknown[]) => freshSignal(...args),
  skillProviderOptions: (...args: unknown[]) => skillProviderOptions(...args),
}));

const {
  buildPlanSchema,
  deriveExecutionSkills,
  finalizeTaskPlan,
  runSupervisorPlan,
} = require('./planner') as typeof import('./planner');

const PROJECTS: DataSource = {
  name: 'Projects',
  collection: 'projects',
  fields: [{ name: 'status', type: 'string' }],
};

describe('buildPlanSchema', () => {
  const basePlan = { needsData: true, query: {} };

  describe('dashboard intent', () => {
    const schema = buildPlanSchema('dashboard');

    it('defaults strategy to "standard" and chartHint to "distribution"', () => {
      const parsed = schema.parse(basePlan);
      expect(parsed.strategy).toBe('standard');
      expect(parsed.chartHint).toBe('distribution');
    });

    it('trims and lowercases a valid strategy', () => {
      const parsed = schema.parse({ ...basePlan, strategy: '  Trend  ' });
      expect(parsed.strategy).toBe('trend');
    });

    it('rejects a strategy outside the 5 allowed values', () => {
      expect(() =>
        schema.parse({ ...basePlan, strategy: 'overview-ish' }),
      ).toThrow();
    });

    it('rejects an empty chartHint instead of silently defaulting', () => {
      expect(() => schema.parse({ ...basePlan, chartHint: '' })).toThrow();
    });
  });

  describe('report intent', () => {
    const schema = buildPlanSchema('report');

    it('allows omitting strategy and chartHint entirely', () => {
      const parsed = schema.parse(basePlan);
      expect(parsed.strategy).toBeUndefined();
      expect(parsed.chartHint).toBeUndefined();
      expect(parsed.wantChart).toBe(false);
    });
  });

  describe('pipeline stage validation (shared across intents)', () => {
    const schema = buildPlanSchema('general_question');

    it('rejects an empty stage object', () => {
      expect(() =>
        schema.parse({ ...basePlan, pipeline: [{}] }),
      ).toThrow();
    });

    it('rejects a stage with no operator key', () => {
      expect(() =>
        schema.parse({ ...basePlan, pipeline: [{ status: 'active' }] }),
      ).toThrow();
    });

    it('rejects a stage with more than one operator key', () => {
      expect(() =>
        schema.parse({ ...basePlan, pipeline: [{ $match: {}, $sort: {} }] }),
      ).toThrow();
    });

    it('accepts a well-formed single-operator stage', () => {
      const parsed = schema.parse({
        ...basePlan,
        pipeline: [{ $match: { status: 'active' } }],
      });
      expect(parsed.pipeline).toEqual([{ $match: { status: 'active' } }]);
    });
  });
});

describe('deriveExecutionSkills', () => {
  it('returns no skills when the plan does not need data, regardless of intent', () => {
    expect(deriveExecutionSkills({ needsData: false }, 'dashboard')).toEqual(
      [],
    );
    expect(deriveExecutionSkills({ needsData: false }, 'report')).toEqual([]);
  });

  it('returns aggregation+chart for a dashboard that needs data', () => {
    expect(deriveExecutionSkills({ needsData: true }, 'dashboard')).toEqual([
      'aggregation',
      'chart',
    ]);
  });

  it('returns aggregation+report for a report without a requested chart', () => {
    expect(
      deriveExecutionSkills({ needsData: true, wantChart: false }, 'report'),
    ).toEqual(['aggregation', 'report']);
  });

  it('returns aggregation+report+chart for a report that wants a chart', () => {
    expect(
      deriveExecutionSkills({ needsData: true, wantChart: true }, 'report'),
    ).toEqual(['aggregation', 'report', 'chart']);
  });

  it('returns aggregation+inquiry for a general question that needs data', () => {
    expect(
      deriveExecutionSkills({ needsData: true }, 'general_question'),
    ).toEqual(['aggregation', 'inquiry']);
  });
});

describe('finalizeTaskPlan', () => {
  function plan(overrides: Partial<TaskPlan> = {}): TaskPlan {
    return {
      needsData: true,
      query: {},
      skills: [] as ExecutionSkillKind[],
      pipeline: [],
      ...overrides,
    };
  }

  it('resolves the source name case/whitespace-insensitively against registered sources', () => {
    const result = finalizeTaskPlan({
      plan: plan({ query: { sourceName: '  projects  ' } }),
      intent: 'dashboard',
      availableSources: [PROJECTS],
    });
    expect(result.query.sourceName).toBe('Projects');
  });

  it('falls back to the raw sourceName when nothing matches', () => {
    const result = finalizeTaskPlan({
      plan: plan({ query: { sourceName: 'not-registered' } }),
      intent: 'dashboard',
      availableSources: [PROJECTS],
    });
    expect(result.query.sourceName).toBe('not-registered');
  });

  it('preserves query.limit', () => {
    const result = finalizeTaskPlan({
      plan: plan({ query: { sourceName: 'Projects', limit: 25 } }),
      intent: 'dashboard',
      availableSources: [PROJECTS],
    });
    expect(result.query.limit).toBe(25);
  });

  it('hoists query.pipeline to the root when root pipeline is empty', () => {
    const withQueryPipeline = plan({
      pipeline: [],
      query: { sourceName: 'Projects', pipeline: [{ $match: { status: 'active' } }] } as never,
    });
    const result = finalizeTaskPlan({
      plan: withQueryPipeline,
      intent: 'dashboard',
      availableSources: [PROJECTS],
    });
    expect(result.pipeline).toEqual([{ $match: { status: 'active' } }]);
  });

  it('prefers the root-level pipeline when both root and query.pipeline are set', () => {
    const withBoth = plan({
      pipeline: [{ $sort: { status: 1 } }],
      query: { sourceName: 'Projects', pipeline: [{ $match: { status: 'active' } }] } as never,
    });
    const result = finalizeTaskPlan({
      plan: withBoth,
      intent: 'dashboard',
      availableSources: [PROJECTS],
    });
    expect(result.pipeline).toEqual([{ $sort: { status: 1 } }]);
  });

  it('derives skills for the finalized plan via deriveExecutionSkills', () => {
    const result = finalizeTaskPlan({
      plan: plan({ needsData: true }),
      intent: 'dashboard',
      availableSources: [PROJECTS],
    });
    expect(result.skills).toEqual(['aggregation', 'chart']);
  });
});

describe('runSupervisorPlan', () => {
  beforeEach(() => {
    generate.mockReset().mockResolvedValue({
      object: { needsData: true, query: { sourceName: 'Projects' }, pipeline: [] },
      usage: { inputTokens: 12, outputTokens: 34 },
    });
    createSkillAgent.mockClear();
    withRateLimitRetry.mockClear();
  });

  it('embeds the retry hint in the user message when one is provided', async () => {
    await runSupervisorPlan({
      prompt: 'top regions by budget',
      intent: 'dashboard',
      sources: [PROJECTS],
      hint: 'strategy must be one of the 5 allowed values',
    });

    const messages = generate.mock.calls[0][0] as { content: string }[];
    const lastMessage = messages[messages.length - 1];
    expect(lastMessage.content).toContain('PREVIOUS ATTEMPT FAILED');
    expect(lastMessage.content).toContain(
      'strategy must be one of the 5 allowed values',
    );
  });

  it('omits the retry-hint wrapper when no hint is provided', async () => {
    await runSupervisorPlan({
      prompt: 'top regions by budget',
      intent: 'dashboard',
      sources: [PROJECTS],
    });

    const messages = generate.mock.calls[0][0] as { content: string }[];
    const lastMessage = messages[messages.length - 1];
    expect(lastMessage.content).not.toContain('PREVIOUS ATTEMPT FAILED');
  });

  it('defaults missing usage fields to 0', async () => {
    generate.mockResolvedValue({
      object: { needsData: false, query: {}, pipeline: [] },
      usage: {},
    });

    const { usage } = await runSupervisorPlan({
      prompt: 'hi',
      intent: 'dashboard',
      sources: [PROJECTS],
    });

    expect(usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('runs the raw model output through finalizeTaskPlan (source resolution + skill derivation)', async () => {
    generate.mockResolvedValue({
      object: {
        needsData: true,
        query: { sourceName: '  projects  ' },
        pipeline: [{ $match: { status: 'active' } }],
      },
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    const { plan } = await runSupervisorPlan({
      prompt: 'active projects',
      intent: 'dashboard',
      sources: [PROJECTS],
    });

    expect(plan.query.sourceName).toBe('Projects');
    expect(plan.skills).toEqual(['aggregation', 'chart']);
  });
});
