import { BadRequestException, HttpException } from '@nestjs/common';
import type { AnalyticsService } from './analytics.service';
import type { PipelineService } from './pipeline.service';
import type { MemoryService } from '../memory/memory.service';
import type { UserSettingsService } from '../user-settings/user-settings.service';
import type {
  AgentConfigService,
  ResolvedConfig,
} from '../agent-config/agent-config.service';
import type { AgentEntry } from '../agent-config/agent-config.repository';

// These services transitively import ai/model.ts, which pulls in
// @mastra/core/agent -> an ESM-only dependency ts-jest can't parse under
// node_modules. This suite only ever exercises AnalyticsService against
// mocked collaborators, so replace the modules outright instead of letting
// Jest load (and choke on) their real implementations.
jest.mock('./pipeline.service', () => ({ PipelineService: class {} }));
jest.mock('../memory/memory.service', () => ({ MemoryService: class {} }));
jest.mock('../user-settings/user-settings.service', () => ({
  UserSettingsService: class {},
}));
jest.mock('../agent-config/agent-config.service', () => ({
  AgentConfigService: class {},
}));
jest.mock('../session/memory', () => ({
  sessionExists: jest.fn().mockResolvedValue(false),
  ensureThread: jest.fn().mockResolvedValue(undefined),
  getMemoryContext: jest.fn().mockResolvedValue([]),
  saveConversationTurn: jest.fn().mockResolvedValue(undefined),
}));

const AnalyticsServiceCtor = (
  require('./analytics.service') as typeof import('./analytics.service')
).AnalyticsService;

function makeAgent(overrides: Partial<AgentEntry> = {}): AgentEntry {
  return {
    id: 'agent-1',
    status: 'active',
    provider: 'anthropic',
    model: 'claude',
    apiKey: 'agent-key',
    inputTokenLimit: 8_000,
    outputTokenLimit: 8_000,
    memoryTokenLimit: 4_000,
    inputTokensUsed: 0,
    outputTokensUsed: 0,
    lastInputTokens: 0,
    ...overrides,
  };
}

function makeConfig(
  agents: AgentEntry[] = [],
  currentAgentId: string | null = null,
): ResolvedConfig {
  return { memoryLimit: 50, currentAgentId, agents };
}

describe('AnalyticsService', () => {
  let pipeline: jest.Mocked<
    Pick<
      PipelineService,
      'execute' | 'executeDashboard' | 'executeReport' | 'executeInquiry'
    >
  >;
  let memory: jest.Mocked<
    Pick<MemoryService, 'getRelevantContext' | 'extractAndSave'>
  >;
  let userSettings: jest.Mocked<
    Pick<UserSettingsService, 'findByUser' | 'incrementUsage'>
  >;
  let agentConfig: jest.Mocked<
    Pick<
      AgentConfigService,
      'getConfig' | 'updateRuntime' | 'trackUsage' | 'updateLastInputTokens'
    >
  >;
  let service: AnalyticsService;

  const successResult = { summary: 'ok' };
  const usage = { inputTokens: 10, outputTokens: 5 };

  beforeEach(() => {
    pipeline = {
      execute: jest.fn().mockResolvedValue({ result: successResult, usage }),
      executeDashboard: jest
        .fn()
        .mockResolvedValue({ result: successResult, usage }),
      executeReport: jest
        .fn()
        .mockResolvedValue({ result: successResult, usage }),
      executeInquiry: jest
        .fn()
        .mockResolvedValue({ result: successResult, usage }),
    };
    memory = {
      getRelevantContext: jest.fn().mockResolvedValue(null),
      extractAndSave: jest
        .fn()
        .mockResolvedValue({ inputTokens: 0, outputTokens: 0 }),
    };
    userSettings = {
      findByUser: jest.fn().mockResolvedValue(null),
      incrementUsage: jest.fn().mockResolvedValue(undefined),
    };
    agentConfig = {
      getConfig: jest.fn().mockResolvedValue(makeConfig()),
      updateRuntime: jest.fn().mockResolvedValue(undefined),
      trackUsage: jest.fn().mockResolvedValue(undefined),
      updateLastInputTokens: jest.fn().mockResolvedValue(undefined),
    };

    service = new AnalyticsServiceCtor(
      pipeline as unknown as PipelineService,
      memory as unknown as MemoryService,
      userSettings as unknown as UserSettingsService,
      agentConfig as unknown as AgentConfigService,
    );
  });

  describe('personal key vs. agent pool access', () => {
    it('uses the personal key when user settings are complete', async () => {
      userSettings.findByUser.mockResolvedValue({
        apiKey: 'user-key',
        provider: 'openai',
        model: 'gpt-5',
      } as never);

      const res = await service.run({ prompt: 'hi', userId: 'u1' });

      expect(res.connection?.source).toBe('personal');
      expect(pipeline.execute).toHaveBeenCalledWith(
        'hi',
        [],
        expect.objectContaining({
          apiKey: 'user-key',
          provider: 'openai',
          model: 'gpt-5',
        }),
      );
    });

    it('rejects incomplete personal settings instead of silently falling back', async () => {
      userSettings.findByUser.mockResolvedValue({
        apiKey: 'user-key',
        provider: '',
        model: '',
      } as never);

      await expect(service.run({ prompt: 'hi', userId: 'u1' })).rejects.toThrow(
        BadRequestException,
      );
      expect(pipeline.execute).not.toHaveBeenCalled();
    });

    it('falls back to the pooled agent when no personal key is set', async () => {
      const agent = makeAgent();
      agentConfig.getConfig.mockResolvedValue(makeConfig([agent], agent.id));

      const res = await service.run({ prompt: 'hi', userId: 'u1' });

      expect(res.connection?.source).toBe('agent');
      expect(res.connection?.agentId).toBe(agent.id);
    });

    it('throws NO_ACTIVE_CONNECTION when no personal key and no active agents exist', async () => {
      agentConfig.getConfig.mockResolvedValue(makeConfig([]));

      await expect(
        service.run({ prompt: 'hi', userId: 'u1' }),
      ).rejects.toMatchObject({
        code: 'NO_ACTIVE_CONNECTION',
      });
    });
  });

  describe('agent failover on provider errors', () => {
    it('marks an agent expired on invalid-key error and retries with the next agent', async () => {
      const bad = makeAgent({ id: 'bad', apiKey: 'bad-key' });
      const good = makeAgent({ id: 'good', apiKey: 'good-key' });
      agentConfig.getConfig.mockResolvedValue(makeConfig([bad, good], bad.id));

      pipeline.execute
        .mockRejectedValueOnce(
          Object.assign(new Error('401 invalid api key'), { statusCode: 401 }),
        )
        .mockResolvedValueOnce({ result: successResult, usage });

      const res = await service.run({ prompt: 'hi', userId: 'u1' });

      expect(res.connection?.agentId).toBe('good');
      expect(agentConfig.updateRuntime).toHaveBeenCalledWith(
        'bad',
        expect.objectContaining({ status: 'expired' }),
      );
      expect(pipeline.execute).toHaveBeenCalledTimes(2);
    });

    it('propagates invalid-key error for a personal key without retrying', async () => {
      userSettings.findByUser.mockResolvedValue({
        apiKey: 'user-key',
        provider: 'openai',
        model: 'gpt-5',
      } as never);
      pipeline.execute.mockRejectedValue(
        Object.assign(new Error('invalid api key'), { statusCode: 401 }),
      );

      await expect(
        service.run({ prompt: 'hi', userId: 'u1' }),
      ).rejects.toMatchObject({
        code: 'INVALID_API_KEY',
      });
    });

    it('drops the oldest half of memory context and retries on a context-length error', async () => {
      const agent = makeAgent();
      agentConfig.getConfig.mockResolvedValue(makeConfig([agent], agent.id));
      memory.getRelevantContext.mockResolvedValue('some long-term memory');

      pipeline.execute
        .mockRejectedValueOnce(
          new Error('context_length_exceeded: too many tokens'),
        )
        .mockResolvedValueOnce({ result: successResult, usage });

      await service.run({ prompt: 'hi', userId: 'u1' });

      const firstContext = pipeline.execute.mock.calls[0]?.[1] ?? [];
      const secondContext = pipeline.execute.mock.calls[1]?.[1] ?? [];
      expect(secondContext.length).toBeLessThan(firstContext.length);
    });

    it('maps a truncated-output error to a TOKEN_LIMIT_TOO_LOW 422 with a suggested limit', async () => {
      const agent = makeAgent();
      agentConfig.getConfig.mockResolvedValue(makeConfig([agent], agent.id));
      pipeline.execute.mockRejectedValue(
        new Error('Unexpected end of JSON input'),
      );

      const err = (await service
        .run({ prompt: 'hi', userId: 'u1' })
        .catch((e: unknown) => e)) as HttpException;

      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(422);
      expect(err.getResponse()).toMatchObject({ code: 'TOKEN_LIMIT_TOO_LOW' });
    });
  });

  describe('pre-flight token guardrails', () => {
    it('rejects before calling the pipeline when memory context exceeds the agent memory limit', async () => {
      const agent = makeAgent({ memoryTokenLimit: 10 });
      agentConfig.getConfig.mockResolvedValue(makeConfig([agent], agent.id));
      memory.getRelevantContext.mockResolvedValue('x'.repeat(1000));

      const err = (await service
        .run({ prompt: 'hi', userId: 'u1' })
        .catch((e: unknown) => e)) as HttpException;

      expect(err.getStatus()).toBe(422);
      expect(err.getResponse()).toMatchObject({
        code: 'MEMORY_TOKEN_LIMIT_TOO_LOW',
      });
      expect(pipeline.execute).not.toHaveBeenCalled();
    });

    it('rejects before calling the pipeline when estimated input tokens exceed the agent input limit', async () => {
      const agent = makeAgent({ inputTokenLimit: 5 });
      agentConfig.getConfig.mockResolvedValue(makeConfig([agent], agent.id));

      const err = (await service
        .run({ prompt: 'hi', userId: 'u1' })
        .catch((e: unknown) => e)) as HttpException;

      expect(err.getStatus()).toBe(422);
      expect(err.getResponse()).toMatchObject({
        code: 'INPUT_TOKEN_LIMIT_TOO_LOW',
      });
      expect(pipeline.execute).not.toHaveBeenCalled();
    });
  });

  describe('prompt validation', () => {
    it('rejects an empty prompt', async () => {
      await expect(service.run({ prompt: '', userId: 'u1' })).rejects.toThrow();
    });

    it('rejects a prompt over 1000 characters', async () => {
      await expect(
        service.run({ prompt: 'x'.repeat(1001), userId: 'u1' }),
      ).rejects.toThrow();
    });
  });
});
