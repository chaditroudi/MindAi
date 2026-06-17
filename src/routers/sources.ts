import { Router } from 'express';
import { getMongo } from '../db/mongo.client.js';
import { getSources, reloadSources } from '../db/sources-cache.js';
import { log } from '../utils/logger.js';
import type { DataSource } from '../types/index.js';

const MODE_META = {
  dashboard: {
    placeholder: 'Example: show projects by status',
    promptFn: (name: string) => `show a dashboard overview of ${name}`,
  },
  report: {
    placeholder: 'Example: generate a report on infrastructure projects',
    promptFn: (name: string) => `generate an analytical report for ${name}`,
  },
  inquiry: {
    placeholder: 'Example: how many projects are in progress?',
    promptFn: (name: string) => `how many records are in ${name}?`,
  },
} as const;

export const sourcesRouter = Router();

sourcesRouter.get('/meta', (_req, res) => {
  const sources = getSources();
  const modes = (Object.entries(MODE_META) as [keyof typeof MODE_META, typeof MODE_META[keyof typeof MODE_META]][])
    .map(([intent, meta]) => ({
      intent,
      placeholder: meta.placeholder,
      prompts: sources.map(source => ({ label: source.name, prompt: meta.promptFn(source.name) })),
    }));
  res.json({ modes });
});

sourcesRouter.get('/sources', (_req, res) => {
  res.json(getSources());
});

sourcesRouter.post('/sources', async (req, res) => {
  try {
    const source = req.body as DataSource;
    if (!source.name || !source.collection || !Array.isArray(source.fields) || !source.fields.length) {
      res.status(400).json({ error: 'source must have name, collection, and at least one field' });
      return;
    }
    const { db } = await getMongo();
    await db.collection('sources').replaceOne({ collection: source.collection }, source, { upsert: true });
    await reloadSources();
    log('sources', `registered: "${source.name}" (${source.collection}) — total: ${getSources().length}`);
    res.json({ ok: true, loaded: getSources().length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

sourcesRouter.delete('/sources/:collection', async (req, res) => {
  try {
    const { db } = await getMongo();
    const result = await db.collection('sources').deleteOne({ collection: req.params.collection });
    if (!result.deletedCount) {
      res.status(404).json({ error: 'source not found' });
      return;
    }
    await reloadSources();
    log('sources', `deleted: "${req.params.collection}" — total: ${getSources().length}`);
    res.json({ ok: true, loaded: getSources().length });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
