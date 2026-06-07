import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { apiRouter } from './http/api-router.js';
import { getMongo, closeMongo } from './db/mongo.client.js';

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

const PORT = Number(process.env.PORT ?? 3000);

async function start() {
  await getMongo();

  const server = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`  POST /api/analytics`);
    console.log(`  POST /api/search`);
    console.log(`  GET  /health`);
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
