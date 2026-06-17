import { Router } from 'express';
import { getMongo } from '../db/mongo.client.js';
import { listCacheEntries, deleteCached } from '../db/prompt-cache.js';
import { log } from '../utils/logger.js';

export const cacheRouter = Router();

cacheRouter.get('/cache', async (_req, res) => {
  try {
    const entries = await listCacheEntries();
    res.json({ count: entries.length, entries });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

cacheRouter.delete('/cache', async (req, res) => {
  try {
    const { key } = req.body as { key?: string };
    if (key) {
      const deleted = await deleteCached(key);
      res.json({ ok: deleted, key });
    } else {
      const { db } = await getMongo();
      const result = await db.collection('prompt_cache').deleteMany({});
      log('cache', `cleared all cache entries | deleted: ${result.deletedCount}`);
      res.json({ ok: true, deleted: result.deletedCount });
    }
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
