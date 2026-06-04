import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { apiRouter } from './http/api-router.js';
import { ensureMongoBootstrap } from './db/bootstrap.js';
import { closeMongo, getMongo } from './db/mongo.client.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
app.use(express.static(publicDir));
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
  try {
    await ensureMongoBootstrap();
  } catch (err) {
    console.warn(
      `[bootstrap] MongoDB unavailable — server will start without pre-seeded data.\n` +
      `  Cause: ${err instanceof Error ? err.message : String(err)}\n` +
      `  Set MONGODB_AUTO_BOOTSTRAP=false to silence this warning.`,
    );
  }

  const server = app.listen(PORT, () => {
    console.log(`Mind viz agents listening on http://localhost:${PORT}`);
    console.log(`  Review UI            http://localhost:${PORT}/`);
    console.log(`  POST /api/inquiry    — home page search / inquiry`);
    console.log(`  POST /api/report     — report page`);
    console.log(`  POST /api/dashboard  — dashboard page single chart`);
  });

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received — shutting down gracefully`);
    server.close(async () => {
      await closeMongo();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
}

start().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
