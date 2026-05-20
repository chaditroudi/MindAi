import type { Mastra } from '@mastra/core/mastra';
import { z } from 'zod';
import { datasetSchema } from '../schemas/intent.js';

const summarySchema = z.object({
  summary: z.string(),
});

const reportSectionsSchema = z.object({
  reportSections: z.array(
    z.object({
      heading: z.string(),
      body: z.string(),
    }),
  ),
});

export async function runInquiryWriter({
  mastra,
  prompt,
  dataset,
}: {
  mastra: Mastra;
  prompt: string;
  dataset: z.infer<typeof datasetSchema>;
}) {
  const writer = mastra.getAgent('writerAgent');
  const result = await writer.generate(
    [
      {
        role: 'system',
        content: 'Return only a JSON object with the shape { "summary": string }. Write the summary in Arabic. Do not return a task plan.',
      },
      {
        role: 'user',
        content: `Summarize these records in 2–4 sentences for the user's question in Arabic. Return JSON: { summary: string }.

Question: ${prompt}
Records (first 10): ${JSON.stringify(dataset.rows.slice(0, 10))}`,
      },
    ],
    { output: summarySchema, maxTokens: 800 },
  );

  return result.object;
}

export async function runReportWriter({
  mastra,
  prompt,
  dataset,
  enrichment,
}: {
  mastra: Mastra;
  prompt: string;
  dataset: z.infer<typeof datasetSchema>;
  enrichment?: z.infer<typeof datasetSchema>;
}) {
  const writer = mastra.getAgent('writerAgent');
  const result = await writer.generate(
    [
      {
        role: 'system',
        content:
          'Return only a JSON object with the shape { "reportSections": [{ "heading": string, "body": string }] }. Write all headings and body text in Arabic. Do not return a task plan.',
      },
      {
        role: 'user',
        content: `Write a structured report in Arabic based on the following data. Return JSON with reportSections: [{heading, body}].

User prompt: ${prompt}
Dataset: ${JSON.stringify(dataset).slice(0, 8000)}
External context: ${JSON.stringify(enrichment ?? null).slice(0, 4000)}`,
      },
    ],
    { output: reportSectionsSchema, maxTokens: 2200 },
  );

  return result.object;
}
