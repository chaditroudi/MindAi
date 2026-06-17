import 'dotenv/config';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { apiRouter } from './routers/index.js';
import { getMongo, closeMongo } from './db/mongo.client.js';
import { initSources, getSources } from './db/sources-cache.js';
import { initCache } from './db/prompt-cache.js';
import { log } from './utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir   = path.resolve(__dirname, '..');

const { port: PORT, shutdownTimeout: SHUTDOWN_TIMEOUT_MS } = config.server;

const angularDistDir = path.join(rootDir, 'client', 'dist', 'mind-ui', 'browser');
const angularBuilt = existsSync(path.join(angularDistDir, 'index.html'));
const staticDir = angularBuilt ? angularDistDir : path.join(rootDir, 'public');
const indexHtml = path.join(staticDir, 'index.html');

const { allowedOrigins } = config.server;

const app = express();
app.disable('x-powered-by');

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors(allowedOrigins.length ? { origin: allowedOrigins, credentials: true } : undefined));
app.use(express.json({ limit: '1mb' }));
app.use('/api', apiRouter);

app.get('/health', async (_req, res) => {
  try {
    const { db } = await getMongo();
    await db.command({ ping: 1 });
    const sources = getSources();
    if (!sources.length) {
      res.status(503).json({ ok: false, mongo: 'connected', sources: 0, detail: 'no data sources loaded' });
      return;
    }
    res.json({ ok: true, mongo: 'connected', sources: sources.length });
  } catch {
    res.status(503).json({ ok: false, mongo: 'unavailable' });
  }
});

app.use(express.static(staticDir));
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  res.sendFile(indexHtml);
});

async function start(): Promise<void> {
  log('server', 'Connecting to MongoDB…');
  await getMongo();
  log('server', 'MongoDB connected');

  log('server', 'Loading data sources…');
  await initSources();

  log('server', 'Initialising prompt cache…');
  await initCache();

  const server = app.listen(PORT, () => {
    log('server', `Ready on http://localhost:${PORT}`);
    log('server', 'Routes: POST /api/analytics · GET /api/meta · DELETE /api/cache · GET /api/history/results · GET /api/history/sessions · GET /health');
  });

  server.once('error', (err: NodeJS.ErrnoException) => {
    const msg = err.code === 'EADDRINUSE'
      ? `Port ${PORT} is already in use — run: npx kill-port ${PORT}`
      : err.message;
    log('server', `Startup error: ${msg}`);
    void closeMongo().finally(() => process.exit(1));
  });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;

    log('server', `${signal} received — closing connections`);

    const forceExit = setTimeout(() => {
      log('server', 'Shutdown timed out — forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    server.close(() => {
      void closeMongo()
        .catch(err => log('server', `Error closing MongoDB: ${String(err)}`))
        .finally(() => {
          log('server', 'Shutdown complete');
          process.exit(0);
        });
    });
    server.closeAllConnections();
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

start().catch((err: unknown) => {
  log('server', `Failed to start: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
