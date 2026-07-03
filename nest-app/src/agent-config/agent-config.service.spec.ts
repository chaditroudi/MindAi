import { AgentConfigService } from './agent-config.service';
import type {
  AgentConfigRepository,
  AgentConfigDocument,
  AgentEntry,
} from './agent-config.repository';

function makeAgent(overrides: Partial<AgentEntry> = {}): AgentEntry {
  return {
    id: 'agent-1',
    status: 'active',
    provider: 'anthropic',
    model: 'claude',
    apiKey: 'key-1',
    inputTokenLimit: 8_000,
    outputTokenLimit: 8_000,
    memoryTokenLimit: 4_000,
    inputTokensUsed: 0,
    outputTokensUsed: 0,
    lastInputTokens: 0,
    ...overrides,
  };
}

function makeDoc(
  overrides: Partial<AgentConfigDocument> = {},
): AgentConfigDocument {
  return {
    memoryLimit: 50,
    currentAgentId: null,
    agents: [],
    ...overrides,
  } as AgentConfigDocument;
}

describe('AgentConfigService', () => {
  let repo: jest.Mocked<
    Pick<
      AgentConfigRepository,
      | 'get'
      | 'save'
      | 'updateCurrentAgentId'
      | 'updateRuntime'
      | 'incrementUsage'
      | 'setLastInputTokens'
      | 'updateAgentStatus'
      | 'updateTokenLimit'
      | 'resetAllUsage'
    >
  >;
  let service: AgentConfigService;

  beforeEach(() => {
    repo = {
      get: jest.fn(),
      save: jest.fn(),
      updateCurrentAgentId: jest.fn().mockResolvedValue(undefined),
      updateRuntime: jest.fn().mockResolvedValue(undefined),
      incrementUsage: jest.fn().mockResolvedValue(undefined),
      setLastInputTokens: jest.fn().mockResolvedValue(undefined),
      updateAgentStatus: jest.fn().mockResolvedValue(undefined),
      updateTokenLimit: jest.fn().mockResolvedValue(undefined),
      resetAllUsage: jest.fn().mockResolvedValue(undefined),
    };
    service = new AgentConfigService(repo as unknown as AgentConfigRepository);
  });

  describe('getConfig', () => {
    it('returns defaults when nothing is persisted yet', async () => {
      repo.get.mockResolvedValue(null);

      const cfg = await service.getConfig();

      expect(cfg).toEqual({
        memoryLimit: 50,
        currentAgentId: null,
        agents: [],
      });
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('assigns ids to agents missing one and persists the correction', async () => {
      const withoutId = { ...makeAgent(), id: '' };
      repo.get.mockResolvedValue(makeDoc({ agents: [withoutId] }));
      repo.save.mockResolvedValue(
        makeDoc({ agents: [{ ...withoutId, id: 'generated' }] }),
      );

      const cfg = await service.getConfig();

      expect(repo.save).toHaveBeenCalledTimes(1);
      const savedAgents = repo.save.mock.calls[0][0].agents;
      expect(savedAgents?.[0]?.id).toBeTruthy();
      expect(cfg.agents).toHaveLength(1);
    });

    it('deduplicates two agents sharing the same id by generating a new one', async () => {
      const a = makeAgent({ id: 'dup' });
      const b = makeAgent({ id: 'dup', apiKey: 'key-2' });
      repo.get.mockResolvedValue(makeDoc({ agents: [a, b] }));
      repo.save.mockResolvedValue(
        makeDoc({ agents: [a, { ...b, id: 'dup-2' }] }),
      );

      await service.getConfig();

      const savedAgents = repo.save.mock.calls[0][0].agents!;
      const ids = savedAgents.map((agent) => agent.id);
      expect(new Set(ids).size).toBe(2);
    });

    it('does not persist anything when ids are already unique and currentAgentId is already correct', async () => {
      const agent = makeAgent();
      repo.get.mockResolvedValue(
        makeDoc({ agents: [agent], currentAgentId: agent.id }),
      );

      const cfg = await service.getConfig();

      expect(repo.save).not.toHaveBeenCalled();
      expect(cfg.currentAgentId).toBe(agent.id);
    });

    it('falls back off a cooling-down currentAgentId to the next active agent', async () => {
      const cooling = makeAgent({
        id: 'cooling',
        cooldownUntil: new Date(Date.now() + 60_000),
      });
      const active = makeAgent({ id: 'active', apiKey: 'key-2' });
      repo.get.mockResolvedValue(
        makeDoc({ agents: [cooling, active], currentAgentId: 'cooling' }),
      );
      repo.save.mockResolvedValue(
        makeDoc({
          agents: [cooling, active],
          currentAgentId: 'active',
        }),
      );

      const cfg = await service.getConfig();

      expect(cfg.currentAgentId).toBe('active');
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ currentAgentId: 'active' }),
      );
    });

    it('resolves currentAgentId to null when no agent is eligible', async () => {
      const disabled = makeAgent({ status: 'disabled' });
      repo.get.mockResolvedValue(
        makeDoc({ agents: [disabled], currentAgentId: disabled.id }),
      );
      repo.save.mockResolvedValue(
        makeDoc({ agents: [disabled], currentAgentId: null }),
      );

      const cfg = await service.getConfig();

      expect(cfg.currentAgentId).toBeNull();
    });
  });

  describe('getCurrentAgent / getActiveAgent', () => {
    it('returns null when there is no current agent', async () => {
      repo.get.mockResolvedValue(makeDoc());
      expect(await service.getCurrentAgent()).toBeNull();
      expect(await service.getActiveAgent()).toBeNull();
    });

    it('returns the agent matching currentAgentId', async () => {
      const agent = makeAgent();
      repo.get.mockResolvedValue(
        makeDoc({ agents: [agent], currentAgentId: agent.id }),
      );

      const current = await service.getCurrentAgent();

      expect(current?.id).toBe(agent.id);
    });
  });

  describe('save', () => {
    it('preserves usage counters for an existing agent identified by id', async () => {
      const existing = makeAgent({
        inputTokensUsed: 500,
        outputTokensUsed: 200,
      });
      repo.get.mockResolvedValue(
        makeDoc({ agents: [existing], currentAgentId: existing.id }),
      );
      repo.save.mockImplementation((data) =>
        Promise.resolve(makeDoc(data as Partial<AgentConfigDocument>)),
      );

      await service.save({
        agents: [{ id: existing.id, model: 'claude-updated' }],
      });

      const savedAgents = repo.save.mock.calls[0][0].agents!;
      expect(savedAgents[0]).toMatchObject({
        inputTokensUsed: 500,
        outputTokensUsed: 200,
        model: 'claude-updated',
      });
    });

    it('matches an existing agent by apiKey when no id is supplied', async () => {
      const existing = makeAgent({ inputTokensUsed: 42 });
      repo.get.mockResolvedValue(
        makeDoc({ agents: [existing], currentAgentId: existing.id }),
      );
      repo.save.mockImplementation((data) =>
        Promise.resolve(makeDoc(data as Partial<AgentConfigDocument>)),
      );

      await service.save({
        agents: [{ apiKey: existing.apiKey, model: 'new-model' }],
      });

      const savedAgents = repo.save.mock.calls[0][0].agents!;
      expect(savedAgents[0]).toMatchObject({
        inputTokensUsed: 42,
        model: 'new-model',
      });
    });

    it('assigns a fresh id to a brand-new agent with no id or apiKey match', async () => {
      repo.get.mockResolvedValue(makeDoc());
      repo.save.mockImplementation((data) =>
        Promise.resolve(makeDoc(data as Partial<AgentConfigDocument>)),
      );

      await service.save({
        agents: [
          {
            provider: 'openai',
            model: 'gpt-5',
            apiKey: 'brand-new-key',
          },
        ],
      });

      const savedAgents = repo.save.mock.calls[0][0].agents!;
      expect(savedAgents[0]?.id).toBeTruthy();
    });
  });

  describe('updateRuntime', () => {
    it('re-syncs the current agent when status changes', async () => {
      const agent = makeAgent();
      repo.get.mockResolvedValue(
        makeDoc({ agents: [agent], currentAgentId: agent.id }),
      );

      await service.updateRuntime(agent.id, { status: 'expired' });

      expect(repo.updateRuntime).toHaveBeenCalledWith(agent.id, {
        status: 'expired',
      });
      expect(repo.get).toHaveBeenCalled();
    });

    it('does not re-sync the current agent for a lastFailureReason-only update', async () => {
      await service.updateRuntime('agent-1', {
        lastFailureReason: 'oops',
      });

      expect(repo.get).not.toHaveBeenCalled();
    });
  });

  describe('usage tracking guards', () => {
    it('trackUsage is a no-op when both token counts are non-positive', async () => {
      await service.trackUsage('agent-1', 0, 0);
      expect(repo.incrementUsage).not.toHaveBeenCalled();
    });

    it('trackUsage forwards when at least one token count is positive', async () => {
      await service.trackUsage('agent-1', 5, 0);
      expect(repo.incrementUsage).toHaveBeenCalledWith('agent-1', 5, 0);
    });

    it('updateLastInputTokens is a no-op for zero or negative values', async () => {
      await service.updateLastInputTokens('agent-1', 0);
      await service.updateLastInputTokens('agent-1', -1);
      expect(repo.setLastInputTokens).not.toHaveBeenCalled();
    });
  });
});
