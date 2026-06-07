import { Router } from 'express';
import { mastra } from '../mastra/index.js';
import { analyticsInputSchema, executeDashboard, executeReport, executeInquiry } from '../mastra/tools/analytics.js';
import { runSearchPlan } from '../mastra/agents/search.js';
import { executePipeline } from '../db/aggregation.js';
import { getSources, reloadSources } from '../db/sources-cache.js';
import { getMongo } from '../db/mongo.client.js';
import type { DataSource } from '../types/index.js';

export const apiRouter = Router();

const TOOL_TO_INTENT: Record<string, string> = {
  'execute-inquiry': 'general_question',
  'build-dashboard': 'dashboard',
  'generate-report': 'report',
};

// ─── Analytics ───────────────────────────────────────────────────────────────

apiRouter.post('/analytics', async (req, res) => {
  try {
    if (!getSources().length) {
      res.status(400).json({
        error:  'No data sources configured.',
        action: 'Register a dataset first → POST /api/sources',
      });
      return;
    }

    const { prompt, intent, sourceName, dataStoreName } = req.body as {
      prompt:         string;
      intent?:        string;
      sourceName?:    string;
      dataStoreName?: string;
    };

    const ctx = analyticsInputSchema.parse({ prompt, sourceName: sourceName ?? dataStoreName });

    // Intent known from dropdown → call directly, no routing LLM needed
    if (intent === 'dashboard') {
      const chart = await executeDashboard(ctx);
      res.json({ intent: 'dashboard', chart });
      return;
    }

    if (intent === 'report') {
      const result = await executeReport(ctx);
      res.json({ intent: 'report', ...result });
      return;
    }

    if (intent === 'general_question' || intent === 'inquiry') {
      const result = await executeInquiry(ctx);
      res.json({ intent: 'general_question', ...result });
      return;
    }

    // No intent → supervisor agent decides which tool to call
    const agentResult = await mastra.getAgent('supervisorAgent').generate(
      [{ role: 'user', content: JSON.stringify(ctx) }],
      { maxSteps: 2, temperature: 0 },
    );

    const toolResult    = agentResult.toolResults?.at(-1);
    const toolName      = (toolResult as { toolName?: string } | undefined)?.toolName ?? '';
    const detectedIntent = TOOL_TO_INTENT[toolName] ?? 'general_question';

    if (toolResult?.result) {
      if (detectedIntent === 'dashboard') {
        res.json({ intent: 'dashboard', chart: toolResult.result });
        return;
      }
      res.json({ intent: detectedIntent, ...(toolResult.result as object) });
      return;
    }

    res.json({ intent: 'general_question', summary: agentResult.text });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Search ──────────────────────────────────────────────────────────────────

apiRouter.post('/search', async (req, res) => {
  try {
    if (!getSources().length) {
      res.status(400).json({
        error:  'No data sources configured.',
        action: 'Register a dataset first → POST /api/sources',
      });
      return;
    }

    const { prompt, sourceName } = req.body as {
      prompt:      string;
      sourceName?: string;
    };

    const plan = await runSearchPlan({ prompt, sourceName });
    const rows = await executePipeline({ pipeline: plan.pipeline, collection: plan.collection });

    res.json({ plan, rows });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Meta ─────────────────────────────────────────────────────────────────────

apiRouter.get('/meta', (_req, res) => {
  const sources = getSources();

  res.json({
    modes: [
      {
        intent:      'dashboard',
        placeholder: 'مثال: أعلى 5 مصادر حسب العدد',
        prompts: sources.map(s => ({
          label:         `رسم بيانات ${s.name}`,
          prompt:        `show a summary chart of ${s.name}`,
          dataStoreName: s.name,
        })),
      },
      {
        intent:      'report',
        placeholder: 'مثال: تحليل تفصيلي للبيانات',
        prompts: sources.map(s => ({
          label:         `تقرير ${s.name}`,
          prompt:        `generate a detailed analytical report for ${s.name}`,
          dataStoreName: s.name,
        })),
      },
      {
        intent:      'inquiry',
        placeholder: 'مثال: ابحث في السجلات',
        prompts: sources.map(s => ({
          label:         `استعلام ${s.name}`,
          prompt:        `find recent records from ${s.name}`,
          dataStoreName: s.name,
        })),
      },
    ],
    sources: sources.map(s => ({
      name:        s.name,
      collection:  s.collection,
      description: s.description ?? '',
      fieldCount:  s.fields.length,
    })),
  });
});

// ─── Sources CRUD ─────────────────────────────────────────────────────────────

apiRouter.get('/sources', (_req, res) => {
  res.json(getSources());
});

apiRouter.post('/sources', async (req, res) => {
  try {
    const source = req.body as DataSource;

    if (!source.name || !source.collection || !Array.isArray(source.fields) || !source.fields.length) {
      res.status(400).json({ error: 'source must have name, collection, and at least one field' });
      return;
    }

    const { db } = await getMongo();
    await db.collection('sources').replaceOne(
      { collection: source.collection },
      source,
      { upsert: true },
    );
    await reloadSources();

    res.json({ ok: true, loaded: getSources().length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

apiRouter.delete('/sources/:collection', async (req, res) => {
  try {
    const { db } = await getMongo();
    const result = await db.collection('sources').deleteOne({ collection: req.params.collection });
    if (!result.deletedCount) {
      res.status(404).json({ error: 'source not found' });
      return;
    }
    await reloadSources();
    res.json({ ok: true, loaded: getSources().length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
