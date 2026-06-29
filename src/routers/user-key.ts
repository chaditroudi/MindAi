import { Router } from 'express';
import { z } from 'zod';
import { saveUserKey, deleteUserKey, getUserKey } from '../db/user-keys.repository.js';
import { PROVIDERS, detectProvider } from '../ai/model.js';

export const userKeyRouter = Router();

const saveSchema = z.object({
  apiKey:   z.string().min(1).max(500),
  model:    z.string().max(200).optional(),
  provider: z.string().max(100).optional(),
});

async function pingKey(apiKey: string, url: string): Promise<'valid' | 'invalid' | 'unreachable'> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (res.status === 200 || res.status === 429) return 'valid'; // 429 = rate-limited but key is valid
    if (res.status === 401 || res.status === 403) return 'invalid';
    return 'unreachable';
  } catch {
    return 'unreachable';
  }
}

function resolveProvider(key: string): { name: string; url: string } | null {
  const provider = detectProvider(key);
  if (!provider) return null;
  const baseURL = PROVIDERS[provider];
  if (!baseURL) return null;
  return { name: provider, url: `${baseURL}/models` };
}

// POST /api/key — verify + save
userKeyRouter.post('/key', async (req, res) => {
  try {
    const userId = (req.headers['x-user-id'] as string | undefined)?.trim();
    if (!userId) { res.status(401).json({ error: 'User ID missing.' }); return; }

    const { apiKey, model, provider: dtoProvider } = saveSchema.parse(req.body);
    const key = apiKey.trim();

    // Provider must be explicitly supplied or auto-detected from key prefix — no silent default.
    const resolvedProvider = dtoProvider?.trim() || resolveProvider(key)?.name;
    if (!resolvedProvider) {
      res.status(400).json({ error: 'Could not detect provider from key. Please select your provider manually.' });
      return;
    }

    const baseURL = PROVIDERS[resolvedProvider];
    if (!baseURL) {
      res.status(400).json({
        error: `Unknown provider "${resolvedProvider}". Supported: ${Object.keys(PROVIDERS).join(', ')}.`,
      });
      return;
    }

    const detected = resolveProvider(key);
    const verifyUrl = detected?.url ?? `${baseURL}/models`;
    const status = await pingKey(key, verifyUrl);

    if (status === 'invalid') {
      res.status(400).json({ error: `This ${resolvedProvider} API key was rejected — it may be incorrect or revoked.` });
      return;
    }
    if (status === 'unreachable') {
      res.status(502).json({ error: `Could not reach ${resolvedProvider} to verify the key. Please check your network connection.` });
      return;
    }

    await saveUserKey(userId, { apiKey: key, model: model?.trim(), provider: resolvedProvider });
    res.json({ ok: true, provider: resolvedProvider });
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
