import type { Mastra } from '@mastra/core/mastra';
import { z } from 'zod';
import { log } from '../../observability/log.js';
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

type ChartPresentation = z.infer<typeof chartPresentationSchema>;

// Extracts a JSON object from LLM text that may contain markdown fences or prose.
function extractJsonObject(text: string): ChartPresentation {
  const trimmed = text.trim();
  // Strip markdown code fences if present
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  // Find first {...} block
  const braceStart = candidate.indexOf('{');
  const braceEnd = candidate.lastIndexOf('}');
  if (braceStart === -1 || braceEnd === -1) {
    throw new Error(`No JSON object found in response: ${candidate.slice(0, 200)}`);
  }
  const json = candidate.slice(braceStart, braceEnd + 1);
  return chartPresentationSchema.parse(JSON.parse(json));
}

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
  const userMessage = {
    role: 'user' as const,
    content:
      'Return ONLY a single JSON object — no markdown, no prose. Schema: ' +
      '{ "title"?: string, "annotations"?: string[], "accessibility": { "description": string } }\n\n' +
      JSON.stringify({
        requestedTitle: title,
        intentHint,
        theme,
        chartType: baseChart.chartType,
        dataset,
        baseAccessibility: baseChart.accessibility.description,
      }),
  };

  async function attemptPresentation(msgs: { role: 'user'; content: string }[]): Promise<ChartPresentation> {
    const result = await chartAgent.generate(msgs, { maxTokens: 700, temperature: 0 });
    return extractJsonObject(result.text ?? '');
  }

  try {
    const presentation = await attemptPresentation([userMessage]);
    return chartResultSchema.parse({
      ...baseChart,
      title: presentation.title?.trim() || baseChart.title,
      annotations: presentation.annotations?.length ? presentation.annotations : undefined,
      accessibility: presentation.accessibility,
    });
  } catch (firstError) {
    log.warn('chart.presentation.retry', {
      agent: 'chartAgent',
      chartType: baseChart.chartType,
      err: firstError instanceof Error ? firstError.message : String(firstError),
    });

    const retryMessage = {
      role: 'user' as const,
      content:
        'Return ONLY a raw JSON object. No markdown fences, no extra text. ' +
        'Schema: { "title"?: string, "annotations"?: string[], "accessibility": { "description": string } }',
    };
    const presentation = await attemptPresentation([userMessage, retryMessage]);
    return chartResultSchema.parse({
      ...baseChart,
      title: presentation.title?.trim() || baseChart.title,
      annotations: presentation.annotations?.length ? presentation.annotations : undefined,
      accessibility: presentation.accessibility,
    });
  }
}
