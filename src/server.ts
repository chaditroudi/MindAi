import 'dotenv/config';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { apiRouter } from './http/api-router.js';
import { getMongo, closeMongo } from './db/mongo.client.js';
import { initSources } from './db/sources-cache.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const angularDistDir = path.join(rootDir, 'client', 'dist', 'mind-ui', 'browser');
const staticDir = existsSync(path.join(angularDistDir, 'index.html'))
  ? angularDistDir
  : path.join(rootDir, 'public');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use('/api', apiRouter);

app.get('/health', async (_req, res) => {
  try {
    const { db } = await getMongo();
    await db.command({ ping: 1 });
    res.json({ ok: true, mongo: 'connected' });
  } catch {
    res.status(503).json({ ok: false, mongo: 'unavailable' });
  }
});

app.use(express.static(staticDir));
app.get(/^(?!\/api|\/health).*/, (_req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

const PORT = Number(process.env.PORT ?? 3000);

async function start() {
  await getMongo();
  await initSources();

  const server = app.listen(PORT, () => {
    console.log(`\nServer running on http://localhost:${PORT}`);
    console.log(`  POST /api/analytics`);
    console.log(`  POST /api/search`);
    console.log(`  GET  /api/meta`);
    console.log(`  GET  /api/sources`);
    console.log(`  POST /api/sources`);
    console.log(`  GET  /health\n`);
  });

  const shutdown = async (signal: string) => {
    console.log(`${signal} — shutting down`);
    server.close(async () => { await closeMongo(); process.exit(0); });
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT',  () => { void shutdown('SIGINT'); });
}

start().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
