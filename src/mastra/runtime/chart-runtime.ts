import type { Mastra } from '@mastra/core/mastra';
import { z } from 'zod';
import { buildChartFromDataset } from '../tools/chart-tools.js';
import { chartResultSchema } from '../schemas/chart.js';
import { datasetSchema } from '../schemas/intent.js';

const chartPresentationSchema = z.object({
  title: z.string().optional(),
  annotations: z.array(z.string()).optional(),
  accessibility: z.object({
    description: z.string(),
  }),
});

export async function runChartRuntime({
  mastra,
  dataset,
  intentHint,
  title,
  theme = 'light',
}: {
  mastra: Mastra;
  dataset: z.infer<typeof datasetSchema>;
  intentHint?: 'compare' | 'trend' | 'distribution' | 'part_of_whole' | 'geo';
  title?: string;
  theme?: 'light' | 'dark' | 'brand';
}) {
  const baseChart = chartResultSchema.parse(
    buildChartFromDataset({
      dataset,
      intentHint,
      title,
      theme,
    }),
  );

  const chartAgent = mastra.getAgent('chartAgent');
  const chartPresentation = await chartAgent.generate(
    [
      {
        role: 'user',
        content: JSON.stringify({
          requestedTitle: title,
          intentHint,
          theme,
          chartType: baseChart.chartType,
          dataset,
          baseAccessibility: baseChart.accessibility.description,
        }),
      },
    ],
    { output: chartPresentationSchema, maxTokens: 700 },
  );

  return chartResultSchema.parse({
    ...baseChart,
    title: chartPresentation.object.title?.trim() || baseChart.title,
    annotations:
      chartPresentation.object.annotations && chartPresentation.object.annotations.length > 0
        ? chartPresentation.object.annotations
        : undefined,
    accessibility: chartPresentation.object.accessibility,
  });
}
