import { Router } from 'express';
import { ZodError } from 'zod';
import {
  dashboardResponseSchema,
  inquiryResponseSchema,
  promptRequestSchema,
  reportResponseSchema,
  reviewMetaSchema,
} from './contracts.js';
import { analyticsService } from '../services/analytics-service.js';
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
    return {
      status: 500,
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
