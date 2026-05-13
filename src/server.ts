import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mastra } from './mastra/index.js';
import type { PermissionScope } from './types/index.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
app.use(express.static(publicDir));

interface ChatBody {
  prompt: string;
  scope: PermissionScope;
  topic?: string;
  blueprintId?: string;
}

type WorkflowRunResponse =
  | {
      intent: 'general_question';
      summary: string;
      recordLinks: Array<{ collection: string; id: string; label: string }>;
      audit: { plan: unknown; elapsedMs: number };
    }
  | {
      intent: 'report';
      reportSections: Array<{ heading: string; body: string }>;
      charts?: unknown[];
      audit: { plan: unknown; elapsedMs: number };
    }
  | {
      intent: 'dashboard';
      chart: unknown;
      audit: { plan: unknown; pipeline: object[]; elapsedMs: number };
    };

function badRequest(res: Response, msg: string) {
  return res.status(400).json({ error: msg });
}

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return { message: error.message, name: error.name };
  }

  return {
    message: typeof error === 'string' ? error : 'unknown error',
    name: 'Error',
  };
}

function validateScope(scope: PermissionScope | undefined) {
  if (!scope) return 'scope is required';
  if (!scope.userId) return 'scope.userId is required';
  if (!scope.tenantId) return 'scope.tenantId is required';
  if (!Array.isArray(scope.allowedBlueprintIds) || scope.allowedBlueprintIds.length === 0) {
    return 'scope.allowedBlueprintIds must contain at least one blueprint id';
  }

  return null;
}

async function runWorkflow(
  workflowId: 'generalQuestionWorkflow' | 'reportWorkflow' | 'dashboardWorkflow',
  inputData: Record<string, unknown>,
) {
  const run = await mastra.getWorkflow(workflowId).createRunAsync();
  const result = await run.start({ inputData });

  if (result.status !== 'success') {
    throw new Error(`Workflow ${workflowId} failed with status "${result.status}"`);
  }

  return result.result;
}

app.post('/api/inquiry', async (req: Request<{}, {}, ChatBody>, res: Response) => {
  const { prompt, scope, topic } = req.body ?? {};
  if (!prompt?.trim()) return badRequest(res, 'prompt is required');
  const scopeError = validateScope(scope);
  if (scopeError) return badRequest(res, scopeError);

  const t0 = Date.now();
  try {
    const result = await runWorkflow('generalQuestionWorkflow', { prompt: prompt.trim(), scope, topic });
    const payload: WorkflowRunResponse = {
      intent: 'general_question',
      summary: result.summary,
      recordLinks: result.recordLinks,
      audit: { plan: result.plan, elapsedMs: Date.now() - t0 },
    };
    res.json(payload);
  } catch (error) {
    const normalized = normalizeError(error);
    res.status(500).json({ error: normalized.message, detail: normalized.name });
  }
});

app.post('/api/report', async (req: Request<{}, {}, ChatBody>, res: Response) => {
  const { prompt, scope, topic, blueprintId } = req.body ?? {};
  if (!prompt?.trim()) return badRequest(res, 'prompt is required');
  const scopeError = validateScope(scope);
  if (scopeError) return badRequest(res, scopeError);

  const t0 = Date.now();
  try {
    const result = await runWorkflow('reportWorkflow', {
      prompt: prompt.trim(),
      scope,
      topic,
      blueprintId,
    });
    const payload: WorkflowRunResponse = {
      intent: 'report',
      reportSections: result.reportSections,
      charts: result.charts,
      audit: { plan: result.plan, elapsedMs: Date.now() - t0 },
    };
    res.json(payload);
  } catch (error) {
    const normalized = normalizeError(error);
    res.status(500).json({ error: normalized.message, detail: normalized.name });
  }
});

app.post('/api/dashboard', async (req: Request<{}, {}, ChatBody>, res: Response) => {
  const { prompt, scope, topic, blueprintId } = req.body ?? {};
  if (!prompt?.trim()) return badRequest(res, 'prompt is required');
  const scopeError = validateScope(scope);
  if (scopeError) return badRequest(res, scopeError);

  const t0 = Date.now();
  try {
    const result = await runWorkflow('dashboardWorkflow', {
      prompt: prompt.trim(),
      scope,
      topic,
      blueprintId,
      intent: 'dashboard',
    });
    const payload: WorkflowRunResponse = {
      intent: 'dashboard',
      chart: result.chart,
      audit: {
        plan: result.plan,
        pipeline: result.executedPipeline,
        elapsedMs: Date.now() - t0,
      },
    };
    res.json(payload);
  } catch (error) {
    const normalized = normalizeError(error);
    res.status(500).json({ error: normalized.message, detail: normalized.name });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => {
  console.log(`Mind viz agents listening on http://localhost:${PORT}`);
  console.log(`  Review UI            http://localhost:${PORT}/`);
  console.log(`  POST /api/inquiry    — home page search / inquiry`);
  console.log(`  POST /api/report     — report page`);
  console.log(`  POST /api/dashboard  — dashboard page single chart`);
});
