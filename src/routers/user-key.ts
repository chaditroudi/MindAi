import { Router } from 'express';
import { z } from 'zod';
import { saveUserKey, deleteUserKey } from '../db/user-keys.repository.js';

export const userKeyRouter = Router();

const saveSchema = z.object({
  userId: z.string().uuid('userId must be a valid UUID'),
  apiKey: z.string().min(1).max(300),
});

userKeyRouter.post('/key', async (req, res) => {
  try {
    const { userId, apiKey } = saveSchema.parse(req.body);
    await saveUserKey(userId, apiKey);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid request' });
  }
});

userKeyRouter.delete('/key/:userId', async (req, res) => {
  try {
    await deleteUserKey(req.params.userId);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete key' });
  }
});
