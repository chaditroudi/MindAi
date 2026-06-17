import { Router } from 'express';
import { z } from 'zod';
import {
  saveResult,
  listResults,
  getResult,
  deleteResult,
} from '../db/saved-results.repository.js';

export const savedResultsRouter = Router();

const saveSchema = z.object({
  title:  z.string().min(1).max(200),
  prompt: z.string().min(1).max(1000),
  intent: z.enum(['dashboard', 'report', 'inquiry']),
  result: z.unknown(),
});

function getUserId(req: import('express').Request): string | null {
  return (req.headers['x-user-id'] as string | undefined)?.trim() || null;
}

savedResultsRouter.post('/saved', async (req, res) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: 'User ID missing.' }); return; }
  try {
    const { title, prompt, intent, result } = saveSchema.parse(req.body);
    const id = await saveResult({ userId, title, prompt, intent, result });
    res.status(201).json({ ok: true, id });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid request' });
  }
});

savedResultsRouter.get('/saved', async (req, res) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: 'User ID missing.' }); return; }
  try {
    const items = await listResults(userId);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? 'request failed' });
  }
});

savedResultsRouter.get('/saved/:id', async (req, res) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: 'User ID missing.' }); return; }
  try {
    const item = await getResult(req.params.id, userId);
    if (!item) { res.status(404).json({ error: 'Not found.' }); return; }
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? 'request failed' });
  }
});

savedResultsRouter.delete('/saved/:id', async (req, res) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: 'User ID missing.' }); return; }
  try {
    const deleted = await deleteResult(req.params.id, userId);
    if (!deleted) { res.status(404).json({ error: 'Not found.' }); return; }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? 'request failed' });
  }
});
