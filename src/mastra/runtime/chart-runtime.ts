import type { Mastra } from '@mastra/core/mastra';
import { z } from 'zod';
import { logged } from '../../observability/log.js';
import { chartResultSchema } from '../schemas/chart.js';
import { datasetSchema } from '../schemas/intent.js';
import { envTimeout, withTimeout } from './timeout.js';

type Dataset = z.infer<typeof datasetSchema>;

export async function runChartRuntime({
  dataset,
  intentHint,
  title,
  theme = 'light',
  mastra,
}: {
  dataset: Dataset;
  intentHint?: 'compare' | 'trend' | 'distribution' | 'part_of_whole' | 'geo' | 'ranking';
  title?: string;
  theme?: 'light' | 'dark' | 'brand';
  mastra: Mastra;
}) {
  const agent = mastra.getAgent('chartAgent');

  const result = await logged(
    'chart.agent.generate',
    { agent: 'chartAgent', rowCount: dataset.rows.length, source: dataset.source },
    () =>
      withTimeout(
        agent.generate(
          [
            {
              role: 'user',
              content: JSON.stringify({ dataset, intentHint, title, theme }),
            },
          ],
          { output: chartResultSchema, maxTokens: 2200, temperature: 0 },
        ),
        'chart.agent.generate',
        envTimeout('CHART_TIMEOUT_MS', 30000),
      ),
  );

  return chartResultSchema.parse(result.object);
}
