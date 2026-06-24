import { Router } from 'express';
import { z } from 'zod';
import { saveUserKey, deleteUserKey, getUserKey } from '../db/user-keys.repository.js';

export const userKeyRouter = Router();

const saveSchema = z.object({
  apiKey: z.string().min(1).max(500),
});

async function pingKey(apiKey: string, url: string): Promise<'valid' | 'invalid' | 'unreachable'> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (res.status === 200) return 'valid';
    if (res.status === 401 || res.status === 403) return 'invalid';
    return 'unreachable';
  } catch {
    return 'unreachable';
  }
}

function resolveProvider(key: string): { name: string; url: string } | null {
  if (key.startsWith('gsk_'))    return { name: 'groq',      url: 'https://api.groq.com/openai/v1/models' };
  if (key.startsWith('sk-ant-')) return { name: 'anthropic', url: 'https://api.anthropic.com/v1/models' };
  if (key.startsWith('sk-'))     return { name: 'openai',    url: 'https://api.openai.com/v1/models' };
  return null;
}

// POST /api/key — verify + save
userKeyRouter.post('/key', async (req, res) => {
  try {
    const userId = (req.headers['x-user-id'] as string | undefined)?.trim();
    if (!userId) { res.status(401).json({ error: 'User ID missing.' }); return; }

    const { apiKey } = saveSchema.parse(req.body);
    const key = apiKey.trim();

    const provider = resolveProvider(key);
    if (!provider) {
      res.status(400).json({ error: 'Unrecognised key format. Use a Groq key (gsk_…) or OpenAI key (sk-…).' });
      return;
    }

    const status = await pingKey(key, provider.url);
    if (status === 'invalid') {
      res.status(400).json({ error: `This ${provider.name} API key was rejected — it may be incorrect or revoked.` });
      return;
    }
    if (status === 'unreachable') {
      res.status(502).json({ error: `Could not reach ${provider.name} to verify the key. Please try again.` });
      return;
    }

    await saveUserKey(userId, key);
    res.json({ ok: true, provider: provider.name });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid request' });
  }
});

// GET /api/key — check if key is saved
userKeyRouter.get('/key', async (req, res) => {
  const userId = (req.headers['x-user-id'] as string | undefined)?.trim();
  if (!userId) { res.status(401).json({ error: 'User ID missing.' }); return; }
  const key = await getUserKey(userId).catch(() => null);
  res.json({ hasKey: !!key });
});

// DELETE /api/key — remove saved key
userKeyRouter.delete('/key', async (req, res) => {
  try {
    const userId = (req.headers['x-user-id'] as string | undefined)?.trim();
    if (!userId) { res.status(401).json({ error: 'User ID missing.' }); return; }
    await deleteUserKey(userId);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete key' });
  }
});
