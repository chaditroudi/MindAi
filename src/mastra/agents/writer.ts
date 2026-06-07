import { generateObject } from 'ai';
import { z } from 'zod';
import { resolveModel } from '../model.js';

const INSTRUCTIONS = `
You are a data insight writer for the Mind Platform analytics service.
Transform dataset rows into clear, accurate, concise narratives.
Detect language from the prompt and respond in the same language.
Never invent data. Never use raw field names in prose.
`;

const summarySchema       = z.object({ summary: z.string() });
const reportSectionsSchema = z.object({
  reportSections: z.array(z.object({ heading: z.string(), body: z.string() })),
});

export async function runInquiryWriter({ prompt, rows }: { prompt: string; rows: unknown[] }) {
  const { object } = await generateObject({
    model:       resolveModel('writer'),
    schema:      summarySchema,
    temperature: 0,
    maxTokens:   512,
    system:      INSTRUCTIONS,
    messages: [{
      role:    'user',
      content: `Question: ${prompt}\nRecords: ${JSON.stringify(rows.slice(0, 10))}`,
    }],
  });
  return object;
}

export async function runReportWriter({ prompt, rows }: { prompt: string; rows: unknown[] }) {
  const { object } = await generateObject({
    model:       resolveModel('writer'),
    schema:      reportSectionsSchema,
    temperature: 0,
    maxTokens:   1024,
    system:      INSTRUCTIONS,
    messages: [{
      role:    'user',
      content: `Prompt: ${prompt}\nDataset: ${JSON.stringify(rows).slice(0, 8000)}`,
    }],
  });
  return object;
}
