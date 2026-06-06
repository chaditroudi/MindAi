import { Router } from 'express';
import { z } from 'zod';
import { mastra } from '../mastra/index.js';
import { analyticsToolInputSchema } from '../mastra/tools/analytics.js';
import { runSearchPlan } from '../mastra/agents/search.js';
import { executePipeline, executePipelineInMemory, validateRows } from '../db/aggregation.js';
import type { DataSource, PermissionScope } from '../types/index.js';

export const apiRouter = Router();

apiRouter.post('/analytics', async (req, res) => {
  try {
    const body = analyticsToolInputSchema.parse(req.body);
    const result = await mastra.getAgent('supervisorAgent').generate(
      [{ role: 'user', content: JSON.stringify(body) }],
      { maxSteps: 2, temperature: 0 },
    );

    const toolResult = result.toolResults?.at(-1);
    if (toolResult?.result) {
      res.json(toolResult.result);
      return;
    }

    res.json({ summary: result.text });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── POST /api/search ────────────────────────────────────────────────────────
// Full-text keyword search across a collection (always explicit — no agent routing).

apiRouter.post('/search', async (req, res) => {
  try {
    const body = z.object({
      prompt:        z.string().min(1),
      scope:         z.object({ userId: z.string().default(''), tenantId: z.string().default('') }).default({}),
      sourceName:    z.string().optional(),
      sources:       z.array(z.unknown()).optional(),
      rows:          z.array(z.record(z.unknown())).optional(),
    }).parse(req.body);

    const scope = body.scope as unknown as PermissionScope;
    const sources = body.sources as DataSource[] | undefined;

    const searchPlan = await runSearchPlan({
      prompt: body.prompt, scope,
      sourceName: body.sourceName,
      sources,
    });

    const rawRows = body.rows?.length
      ? executePipelineInMemory({ pipeline: searchPlan.pipeline, rows: body.rows, scope }).rows
      : (await executePipeline({ pipeline: searchPlan.pipeline, collection: searchPlan.collection, scope })).rows;

    const { rows, schema } = validateRows(rawRows);
    res.json({ searchPlan, dataset: { rows, schema, source: 'search' } });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
