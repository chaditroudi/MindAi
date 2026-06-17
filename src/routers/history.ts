import { Router } from 'express';
import { histRepo } from '../db/results-history.repository.js';
import {
  listSessions,
  getSessionDetail,
  deleteSession,
} from '../session/memory.js';

export const historyRouter = Router();

historyRouter.get('/history/results', async (req, res) => {
  try {
    const intent = typeof req.query.intent === 'string' ? req.query.intent : undefined;
    const skip   = Number(req.query.skip)  || 0;
    const limit  = Math.min(Number(req.query.limit) || 20, 100);
    const [items, total] = await Promise.all([
      histRepo.list({ intent, skip, limit }),
      histRepo.count({ intent }),
    ]);
    res.json({ total, skip, limit, items });
  } catch (err) {
    res.status(500).json({ error: (err as Error)?.message || 'unknown error' });
  }
});

historyRouter.get('/history/results/:id', async (req, res) => {
  try {
    const doc = await histRepo.findById(req.params.id);
    if (!doc) { res.status(404).json({ error: 'not found' }); return; }
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: (err as Error)?.message || 'unknown error' });
  }
});

historyRouter.get('/history/sessions', async (_req, res) => {
  try {
    res.json(await listSessions());
  } catch (err) {
    res.status(500).json({ error: (err as Error)?.message || 'unknown error' });
  }
});

historyRouter.get('/history/sessions/:sessionId', async (req, res) => {
  try {
    const session = await getSessionDetail(req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: 'session not found' });
      return;
    }
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: (err as Error)?.message || 'unknown error' });
  }
});

historyRouter.delete('/history/sessions/:sessionId', async (req, res) => {
  try {
    const ok = await deleteSession(req.params.sessionId);
    if (!ok) {
      res.status(404).json({ error: 'session not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error)?.message || 'unknown error' });
  }
});
