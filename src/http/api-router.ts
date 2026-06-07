import { Router } from 'express';
import { mastra } from '../mastra/index.js';
import { analyticsInputSchema } from '../mastra/tools/analytics.js';
import { runSearchPlan } from '../mastra/agents/search.js';
import { executePipeline } from '../db/aggregation.js';

export const apiRouter = Router();

const TOOL_TO_INTENT: Record<string, string> = {
  'execute-inquiry': 'general_question',
  'build-dashboard': 'dashboard',
  'generate-report': 'report',
};

apiRouter.post('/analytics', async (req, res) => {
  try {
    const { prompt, intent, sourceName, sources } = req.body as {
      prompt:      string;
      intent?:     string;
      sourceName?: string;
      sources?:    unknown[];
    };

    // Merge the selected mode into the prompt so the supervisor agent routes correctly
    const hintedPrompt = intent ? `[Mode: ${intent}] ${prompt}` : prompt;

    const body   = analyticsInputSchema.parse({ prompt: hintedPrompt, sourceName, sources });
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

apiRouter.post('/search', async (req, res) => {
  try {
    const { prompt, sourceName, sources } = req.body as {
      prompt:      string;
      sourceName?: string;
      sources?:    unknown[];
    };

    const plan = await runSearchPlan({ prompt, sourceName, sources: sources as never });
    const rows = await executePipeline({ pipeline: plan.pipeline, collection: plan.collection });

    res.json({ plan, rows });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
