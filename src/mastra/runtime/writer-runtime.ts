import type { Mastra } from '@mastra/core/mastra';
import { z } from 'zod';
import { log } from '../../observability/log.js';
import { datasetSchema } from '../schemas/intent.js';
import { envTimeout, withTimeout } from './timeout.js';

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
  const messages = [
    {
      role: 'system' as const,
      content: 'Return only a JSON object with the shape { "summary": string }. Write the summary in Arabic. Do not return a task plan.',
    },
    {
      role: 'user' as const,
      content: `Summarize these records in 2–4 sentences for the user's question in Arabic. Return JSON: { summary: string }.

Question: ${prompt}
Records (first 10): ${JSON.stringify(dataset.rows.slice(0, 10))}`,
    },
  ];
  const timeoutMs = envTimeout('WRITER_TIMEOUT_MS', 10000);

  try {
    const result = await withTimeout(
      writer.generate(messages, { output: summarySchema, maxTokens: 800, temperature: 0 }),
      'writer.inquiry',
      timeoutMs,
    );
    return result.object;
  } catch (error) {
    log.warn('writer.inquiry.retry', {
      agent: 'writerAgent',
      rowCount: dataset.rows.length,
      err: error instanceof Error ? error.message : String(error),
    });
    try {
      const retry = await withTimeout(
        writer.generate(
          [
            {
              role: 'system',
              content:
                'Your previous response was invalid JSON. Return exactly one valid JSON object matching { "summary": string }. No markdown or prose outside JSON.',
            },
            ...messages,
          ],
          { output: summarySchema, maxTokens: 800, temperature: 0 },
        ),
        'writer.inquiry.retry',
        Math.min(timeoutMs, 5000),
      );
      return retry.object;
    } catch (retryError) {
      log.error('writer.inquiry.failed', {
        agent: 'writerAgent',
        rowCount: dataset.rows.length,
        err: retryError instanceof Error ? retryError.message : String(retryError),
      });
      throw retryError;
    }
  }
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
  const messages = [
    {
      role: 'system' as const,
      content:
        'Return only a JSON object with the shape { "reportSections": [{ "heading": string, "body": string }] }. Write all headings and body text in Arabic. Do not return a task plan.',
    },
    {
      role: 'user' as const,
      content: `Write a structured report in Arabic based on the following data. Return JSON with reportSections: [{heading, body}].

User prompt: ${prompt}
Dataset: ${JSON.stringify(dataset).slice(0, 8000)}
External context: ${JSON.stringify(enrichment ?? null).slice(0, 4000)}`,
    },
  ];
  const timeoutMs = envTimeout('WRITER_TIMEOUT_MS', 10000);

  try {
    const result = await withTimeout(
      writer.generate(messages, {
        output: reportSectionsSchema,
        maxTokens: 2200,
        temperature: 0,
      }),
      'writer.report',
      timeoutMs,
    );
    return result.object;
  } catch (error) {
    log.warn('writer.report.retry', {
      agent: 'writerAgent',
      rowCount: dataset.rows.length,
      err: error instanceof Error ? error.message : String(error),
    });
    try {
      const retry = await withTimeout(
        writer.generate(
          [
            {
              role: 'system',
              content:
                'Your previous response was invalid JSON. Return exactly one valid JSON object matching { "reportSections": [{ "heading": string, "body": string }] }. No markdown or prose outside JSON.',
            },
            ...messages,
          ],
          { output: reportSectionsSchema, maxTokens: 2200, temperature: 0 },
        ),
        'writer.report.retry',
        Math.min(timeoutMs, 5000),
      );
      return retry.object;
    } catch (retryError) {
      log.error('writer.report.failed', {
        agent: 'writerAgent',
        rowCount: dataset.rows.length,
        err: retryError instanceof Error ? retryError.message : String(retryError),
      });
      throw retryError;
    }
  }
}
