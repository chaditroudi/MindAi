import { Router } from 'express';
import { mastra } from '../mastra/index.js';
import { analyticsInputSchema } from '../mastra/tools/analytics.js';
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
    const { prompt, intent, sourceName, dataStoreName } = req.body as {
      prompt:         string;
      intent?:        string;
      sourceName?:    string;
      dataStoreName?: string;
    };
    const resolvedSource = sourceName ?? dataStoreName;
    const hintedPrompt   = intent ? `[Mode: ${intent}] ${prompt}` : prompt;

    const body   = analyticsInputSchema.parse({ prompt: hintedPrompt, sourceName: resolvedSource, intent });
    const result = await mastra.getAgent('supervisorAgent').generate(
      [{ role: 'user', content: JSON.stringify(body) }],
      { maxSteps: 2, temperature: 0 },
    );

    const toolResult = result.toolResults?.at(-1);
    if (toolResult?.result) {
      const toolName       = (toolResult as { toolName?: string }).toolName ?? '';
      const resolvedIntent = intent ?? TOOL_TO_INTENT[toolName] ?? 'general_question';

      if (resolvedIntent === 'dashboard') {
        res.json({ intent: 'dashboard', chart: toolResult.result });
        return;
      }

      res.json({ intent: resolvedIntent, ...(toolResult.result as object) });
      return;
    }

    res.json({ intent: 'general_question', summary: result.text });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Search ──────────────────────────────────────────────────────────────────

apiRouter.post('/search', async (req, res) => {
  try {
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
