import { Router } from 'express';
import { ZodError } from 'zod';
import {
  dashboardResponseSchema,
  historyQuerySchema,
  inquiryResponseSchema,
  promptRequestSchema,
  reportResponseSchema,
  reviewMetaSchema,
  searchResponseSchema,
} from './contracts.js';
import { analyticsService } from '../services/analytics-service.js';
import { dataStoreRepo } from '../db/datastore.repository.js';
import { historyRepo } from '../db/results-history.repository.js';
import { getMongo } from '../db/mongo.client.js';
import { log, logged, newRunId } from '../observability/log.js';

function normalizeError(error: unknown) {
  if (error instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: 'بيانات الطلب غير صالحة',
        detail: error.flatten(),
      },
    };
  }

  if (error instanceof Error) {
    const isMongoUnavailable = /MongoDB is not reachable/i.test(error.message);
    const isClientInputError = /dataset is required/i.test(error.message);
    return {
      status: isClientInputError ? 400 : isMongoUnavailable ? 503 : 500,
      body: {
        error: error.message,
        detail: error.name,
      },
    };
  }

  return {
    status: 500,
    body: {
      error: 'خطأ غير معروف',
      detail: 'خطأ',
    },
  };
}

export const apiRouter = Router();

apiRouter.post('/admin/clear-memory', async (_req, res) => {
  try {
    // 1. Clear the in-RAM schema cache so supervisor re-reads data_stores from MongoDB
    dataStoreRepo.invalidateCache();

    // 2. Clear all conversation memory from MongoDB
    const { db } = await getMongo();
    const result = await db.collection('conversation_memory').deleteMany({});

    log.info('admin.clear-memory', { deletedConversations: result.deletedCount });
    res.json({
      ok: true,
      schemaCacheCleared: true,
      conversationMemoryDeleted: result.deletedCount,
    });
  } catch (error) {
    const normalized = normalizeError(error);
    res.status(normalized.status).json(normalized.body);
  }
});

apiRouter.get('/meta', async (_req, res) => {
  try {
    const payload = reviewMetaSchema.parse(await analyticsService.getReviewMeta());
    res.json(payload);
  } catch (error) {
    const normalized = normalizeError(error);
    res.status(normalized.status).json(normalized.body);
  }
});

apiRouter.post('/inquiry', async (req, res) => {
  const runId = newRunId();
  try {
    const input = promptRequestSchema.parse(req.body ?? {});
    log.info('api.inquiry.received', { runId, tenantId: input.scope?.tenantId, promptLen: input.prompt.length });
    const payload = await logged(
      'api.inquiry',
      { runId, tenantId: input.scope?.tenantId },
      async () => inquiryResponseSchema.parse(await analyticsService.runInquiry(input)),
    );
    res.setHeader('x-run-id', runId);
    res.json(payload);
  } catch (error) {
    const normalized = normalizeError(error);
    log.error('api.inquiry.failed', { runId, status: normalized.status, error: String((normalized.body as any).error) });
    res.setHeader('x-run-id', runId);
    res.status(normalized.status).json(normalized.body);
  }
});

apiRouter.post('/report', async (req, res) => {
  const runId = newRunId();
  try {
    const input = promptRequestSchema.parse(req.body ?? {});
    log.info('api.report.received', { runId, tenantId: input.scope?.tenantId, promptLen: input.prompt.length });
    const payload = await logged(
      'api.report',
      { runId, tenantId: input.scope?.tenantId },
      async () => reportResponseSchema.parse(await analyticsService.runReport(input)),
    );
    res.setHeader('x-run-id', runId);
    res.json(payload);
  } catch (error) {
    const normalized = normalizeError(error);
    log.error('api.report.failed', { runId, status: normalized.status, error: String((normalized.body as any).error) });
    res.setHeader('x-run-id', runId);
    res.status(normalized.status).json(normalized.body);
  }
});

apiRouter.post('/search', async (req, res) => {
  const runId = newRunId();
  try {
    const input = promptRequestSchema.parse(req.body ?? {});
    log.info('api.search.received', { runId, tenantId: input.scope?.tenantId, promptLen: input.prompt.length });
    const payload = await logged(
      'api.search',
      { runId, tenantId: input.scope?.tenantId },
      async () => searchResponseSchema.parse(await analyticsService.runSearch(input)),
    );
    res.setHeader('x-run-id', runId);
    res.json(payload);
  } catch (error) {
    const normalized = normalizeError(error);
    log.error('api.search.failed', { runId, status: normalized.status, error: String((normalized.body as any).error) });
    res.setHeader('x-run-id', runId);
    res.status(normalized.status).json(normalized.body);
  }
});

// ─── History endpoints ────────────────────────────────────────────────────────

apiRouter.get('/history', async (req, res) => {
  try {
    const query = historyQuerySchema.parse(req.query);
    const [entries, total] = await Promise.all([
      historyRepo.list({ tenantId: query.tenantId, intent: query.intent, limit: query.limit, skip: query.skip }),
      historyRepo.count({ tenantId: query.tenantId, intent: query.intent }),
    ]);
    res.json({
      entries: entries.map(serializeEntry),
      total,
      limit: query.limit,
      skip: query.skip,
    });
  } catch (error) {
    const normalized = normalizeError(error);
    res.status(normalized.status).json(normalized.body);
  }
});

apiRouter.get('/history/:id', async (req, res) => {
  try {
    const tenantId = String(req.query.tenantId ?? '');
    if (!tenantId) { res.status(400).json({ error: 'tenantId is required' }); return; }
    const entry = await historyRepo.findById(req.params.id, tenantId);
    if (!entry) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(serializeEntry(entry));
  } catch (error) {
    const normalized = normalizeError(error);
    res.status(normalized.status).json(normalized.body);
  }
});

apiRouter.delete('/history/:id', async (req, res) => {
  try {
    const tenantId = String(req.query.tenantId ?? '');
    if (!tenantId) { res.status(400).json({ error: 'tenantId is required' }); return; }
    const deleted = await historyRepo.deleteById(req.params.id, tenantId);
    if (!deleted) { res.status(404).json({ error: 'Not found' }); return; }
    res.json({ ok: true });
  } catch (error) {
    const normalized = normalizeError(error);
    res.status(normalized.status).json(normalized.body);
  }
});

function serializeEntry(entry: Awaited<ReturnType<typeof historyRepo.findById>>) {
  if (!entry) return null;
  return {
    id: entry._id?.toHexString() ?? '',
    tenantId: entry.tenantId,
    userId: entry.userId,
    intent: entry.intent,
    prompt: entry.prompt,
    pipeline: entry.pipeline,
    result: entry.result,
    durationMs: entry.durationMs,
    createdAt: entry.createdAt.toISOString(),
  };
}

apiRouter.post('/dashboard', async (req, res) => {
  const runId = newRunId();
  try {
    const input = promptRequestSchema.parse(req.body ?? {});
    log.info('api.dashboard.received', { runId, tenantId: input.scope?.tenantId, promptLen: input.prompt.length });
    const payload = await logged(
      'api.dashboard',
      { runId, tenantId: input.scope?.tenantId },
      async () => dashboardResponseSchema.parse(await analyticsService.runDashboard(input)),
    );
    res.setHeader('x-run-id', runId);
    res.json(payload);
  } catch (error) {
    const normalized = normalizeError(error);
    log.error('api.dashboard.failed', { runId, status: normalized.status, error: String((normalized.body as any).error) });
    res.setHeader('x-run-id', runId);
    res.status(normalized.status).json(normalized.body);
  }
});
