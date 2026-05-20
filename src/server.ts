import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { apiRouter } from './http/api-router.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
app.use(express.static(publicDir));
app.use('/api', apiRouter);

app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => {
  console.log(`Mind viz agents listening on http://localhost:${PORT}`);
  console.log(`  Review UI            http://localhost:${PORT}/`);
  console.log(`  Team Docs            http://localhost:${PORT}/docs.html`);
  console.log(`  POST /api/inquiry    — home page search / inquiry`);
  console.log(`  POST /api/report     — report page`);
  console.log(`  POST /api/dashboard  — dashboard page single chart`);
});
