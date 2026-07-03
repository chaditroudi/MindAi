import { SourcesService } from './sources.service';
import { setSourcesCache } from './sources-cache';
import type { DataSource } from '../types';

function makeSource(overrides: Partial<DataSource> = {}): DataSource {
  return {
    name: 'Projects',
    collection: 'projects',
    fields: [{ name: 'status', type: 'string' }],
    ...overrides,
  };
}

function makeModel(docs: DataSource[] = []) {
  const lean = jest.fn().mockResolvedValue(docs);
  const select = jest.fn().mockReturnValue({ lean });
  const find = jest.fn().mockReturnValue({ select });
  const replaceOne = jest.fn().mockResolvedValue({ acknowledged: true });
  const deleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 });
  return { find, select, lean, replaceOne, deleteOne };
}

describe('SourcesService', () => {
  afterEach(() => {
    setSourcesCache([]);
  });

  describe('onModuleInit', () => {
    it('loads persisted sources into the shared cache', async () => {
      const docs = [makeSource()];
      const model = makeModel(docs);
      const service = new SourcesService(model as unknown as never);

      await service.onModuleInit();

      expect(model.find).toHaveBeenCalledWith({});
      expect(service.list()).toEqual(docs);
    });
  });

  describe('getMeta', () => {
    it('returns one mode entry per intent, each with a prompt per registered source', () => {
      setSourcesCache([makeSource({ name: 'Projects' })]);
      const service = new SourcesService(makeModel() as unknown as never);

      const meta = service.getMeta();

      expect(meta.modes.map((m) => m.intent)).toEqual([
        'dashboard',
        'report',
        'inquiry',
      ]);
      const dashboard = meta.modes.find((m) => m.intent === 'dashboard')!;
      expect(dashboard.prompts).toEqual([
        { label: 'Projects', prompt: 'show a dashboard overview of Projects' },
      ]);
    });

    it('returns empty prompt lists when no sources are registered', () => {
      setSourcesCache([]);
      const service = new SourcesService(makeModel() as unknown as never);

      const meta = service.getMeta();

      for (const mode of meta.modes) expect(mode.prompts).toEqual([]);
    });
  });

  describe('register', () => {
    it('upserts by collection name and reloads the cache from the database', async () => {
      const source = makeSource();
      const model = makeModel([source]);
      const service = new SourcesService(model as unknown as never);

      const result = await service.register(source);

      expect(model.replaceOne).toHaveBeenCalledWith(
        { collection: source.collection },
        source,
        { upsert: true },
      );
      expect(model.find).toHaveBeenCalled(); // reloadCache was triggered
      expect(result).toEqual({ ok: true, loaded: 1 });
      expect(service.list()).toEqual([source]);
    });
  });

  describe('remove', () => {
    it('returns false and does not reload the cache when nothing was deleted', async () => {
      const model = makeModel();
      model.deleteOne.mockResolvedValue({ deletedCount: 0 });
      const service = new SourcesService(model as unknown as never);
      model.find.mockClear();

      const removed = await service.remove('projects');

      expect(removed).toBe(false);
      expect(model.find).not.toHaveBeenCalled();
    });

    it('returns true and reloads the cache when a source was deleted', async () => {
      const model = makeModel([]);
      const service = new SourcesService(model as unknown as never);

      const removed = await service.remove('projects');

      expect(model.deleteOne).toHaveBeenCalledWith({ collection: 'projects' });
      expect(removed).toBe(true);
      expect(model.find).toHaveBeenCalled();
    });
  });
});
