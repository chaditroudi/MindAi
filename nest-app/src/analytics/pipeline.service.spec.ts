import type { CacheService } from '../cache/cache.service';
import type { HistoryService } from '../history/history.service';
import type { ChartResultsRepository } from '../ai/chart-results.repository';
import type { DataSource } from '../types';
import { patchConvert } from './pipeline.service';

// PipelineService imports the LLM skills as values (for the aggregation
// planner call), and those transitively pull in @mastra/core/agent, which
// ships an ESM-only dependency ts-jest can't parse under node_modules. None
// of that is exercised here — these tests only drive the pure pipeline
// safety logic (resolvePipeline) — so stub the skill modules out entirely.
jest.mock('../ai/planner', () => ({ runSupervisorPlan: jest.fn() }));
jest.mock('../ai/chart', () => ({ runChart: jest.fn() }));
jest.mock('../ai/writer', () => ({
  runReportSkill: jest.fn(),
  runInquirySkill: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PipelineService } = require('./pipeline.service') as typeof import('./pipeline.service');

const SOURCE: DataSource = {
  name: 'Projects',
  collection: 'projects',
  fields: [
    { name: 'status', type: 'string', role: 'dimension' },
    { name: 'budget', type: 'number', role: 'measure' },
    { name: 'region', type: 'string', role: 'dimension' },
  ],
};

function makePlan(pipeline: Record<string, unknown>[]): {
  needsData: boolean;
  query: { sourceName: string };
  skills: string[];
  pipeline: Record<string, unknown>[];
} {
  return {
    needsData: true,
    query: { sourceName: 'Projects' },
    skills: ['aggregation'],
    pipeline,
  };
}

describe('PipelineService.resolvePipeline (private, exercised via bracket access)', () => {
  let service: InstanceType<typeof PipelineService>;

  beforeEach(() => {
    const connection = {} as never;
    const cache = {} as CacheService;
    const history = {} as HistoryService;
    const chartRepo = {} as ChartResultsRepository;
    service = new PipelineService(connection, cache, history, chartRepo);
  });

  function resolve(pipeline: Record<string, unknown>[]) {
    return (service as unknown as { resolvePipeline: Function }).resolvePipeline(
      makePlan(pipeline),
      [SOURCE],
    );
  }

  it('resolves a well-formed pipeline against the matching registered source', () => {
    const result = resolve([{ $match: { status: 'active' } }]);
    expect(result).toEqual({
      pipeline: [{ $match: { status: 'active' } }],
      collection: 'projects',
    });
  });

  it('matches the source case/whitespace-insensitively by name or collection', () => {
    const plan = makePlan([{ $match: { status: 'active' } }]);
    plan.query.sourceName = '  projects  ';
    const result = (service as unknown as { resolvePipeline: Function }).resolvePipeline(
      plan,
      [SOURCE],
    );
    expect(result.collection).toBe('projects');
  });

  it('rejects a query against an unregistered data source', () => {
    const plan = makePlan([{ $match: { status: 'active' } }]);
    plan.query.sourceName = 'not-a-real-source';
    expect(() =>
      (service as unknown as { resolvePipeline: Function }).resolvePipeline(plan, [SOURCE]),
    ).toThrow(/No registered data source/);
  });

  describe('forbidden stage denylist (security boundary)', () => {
    it.each(['$merge', '$out', '$function', '$where', '$unionWith', '$graphLookup'])(
      'rejects a pipeline containing %s',
      (stage) => {
        expect(() => resolve([{ [stage]: {} }])).toThrow(/not permitted/);
      },
    );

    it('rejects a forbidden stage even when it is not the first stage', () => {
      expect(() =>
        resolve([{ $match: { status: 'active' } }, { $merge: { into: 'other' } }]),
      ).toThrow(/not permitted/);
    });

    it('allows the standard analytical stages', () => {
      expect(() =>
        resolve([
          { $match: { status: 'active' } },
          { $group: { _id: '$region', total: { $sum: '$budget' } } },
          { $sort: { total: -1 } },
        ]),
      ).not.toThrow();
    });
  });

  describe('stage shape validation', () => {
    it('rejects a non-object stage', () => {
      expect(() => resolve(['not-an-object' as never])).toThrow(
        /must be a plain object/,
      );
    });

    it('rejects an empty stage object', () => {
      expect(() => resolve([{}])).toThrow(/must not be empty/);
    });

    it('rejects a stage with no operator key', () => {
      expect(() => resolve([{ status: 'active' }])).toThrow(
        /must include exactly one MongoDB operator key/,
      );
    });

    it('rejects a stage with more than one operator key', () => {
      expect(() => resolve([{ $match: {}, $sort: {} }])).toThrow(
        /must contain exactly one MongoDB operator key/,
      );
    });

    it('strips non-operator commentary keys instead of failing', () => {
      const result = resolve([
        { $match: { status: 'active' }, note: 'explaining the filter' } as never,
      ]);
      expect(result.pipeline).toEqual([{ $match: { status: 'active' } }]);
    });
  });

  describe('field reference validation', () => {
    it('rejects a $match referencing an unregistered field', () => {
      expect(() => resolve([{ $match: { nonexistentField: 'x' } }])).toThrow(
        /references field\(s\) not registered/,
      );
    });

    it('allows referencing a field computed earlier by $group', () => {
      expect(() =>
        resolve([
          { $group: { _id: '$region', totalBudget: { $sum: '$budget' } } },
          { $match: { totalBudget: { $gt: 1000 } } },
        ]),
      ).not.toThrow();
    });

    it('validates $lookup.localField and allows referencing its "as" alias downstream', () => {
      expect(() =>
        resolve([
          {
            $lookup: {
              from: 'other',
              localField: 'region',
              foreignField: '_id',
              as: 'regionDoc',
            },
          },
          { $match: { regionDoc: { $exists: true } } },
        ]),
      ).not.toThrow();
    });

    it('rejects $lookup.localField referencing an unregistered field', () => {
      expect(() =>
        resolve([
          {
            $lookup: {
              from: 'other',
              localField: 'notAField',
              foreignField: '_id',
              as: 'regionDoc',
            },
          },
        ]),
      ).toThrow(/references field\(s\) not registered/);
    });
  });
});

describe('patchConvert', () => {
  it('defaults onError/onNull to null for date conversions', () => {
    const input = { $convert: { input: '$startYear', to: 'date' } };
    expect(patchConvert(input)).toEqual({
      $convert: { input: '$startYear', to: 'date', onError: null, onNull: null },
    });
  });

  it('does not override an explicitly provided onError/onNull', () => {
    const input = {
      $convert: { input: '$x', to: 'date', onError: 'ERR', onNull: 'NULL' },
    };
    expect(patchConvert(input)).toEqual(input);
  });

  it('leaves non-date conversions untouched', () => {
    const input = { $convert: { input: '$x', to: 'int' } };
    expect(patchConvert(input)).toEqual(input);
  });

  it('recurses into nested objects and arrays', () => {
    const input = [
      { $match: { a: 1 } },
      {
        $project: {
          year: { $convert: { input: '$y', to: 'date' } },
        },
      },
    ];
    expect(patchConvert(input)).toEqual([
      { $match: { a: 1 } },
      {
        $project: {
          year: { $convert: { input: '$y', to: 'date', onError: null, onNull: null } },
        },
      },
    ]);
  });

  it('passes through primitives and null unchanged', () => {
    expect(patchConvert(null)).toBeNull();
    expect(patchConvert('x')).toBe('x');
    expect(patchConvert(5)).toBe(5);
  });
});
