import { Agent } from '@mastra/core/agent';
import { generateObject } from 'ai';
import { z } from 'zod';
import { resolveModel } from '../model.js';
import { datasetSchema } from '../schemas/intent.js';
import { envTimeout, withTimeout } from '../../utils/timeout.js';

const BASE_INSTRUCTIONS = `
You are a Data Reporting and Insight Writer for the Mind Platform analytics service.
Your job is to transform aggregated dataset rows into clear, accurate, actionable narratives.

LANGUAGE: Detect from user prompt. Arabic → Arabic. English → English. Never mix.

MODES:
  general_question → { "summary": string } — 2–4 sentences
  report           → { "reportSections": [{ "heading": string, "body": string }] }

DATASET CONVENTIONS:
  "value" = primary metric · "percent" = X.X% share · "benchmark" = reference value

SUMMARY: Lead with the most notable finding. Empty dataset → "No records matched."

REPORT SECTIONS: Executive Summary · Key Findings (3–5, data-grounded) · Detailed Analysis ·
  Risks/Issues · Recommendations · Conclusion

QUALITY: Concise, accurate, evidence-based. Never invent data or use raw field names in prose.

OUTPUT: Valid JSON only. No markdown, code fences, or extra keys.
`;

export const writerAgent = new Agent({ name: 'Writer Agent', instructions: BASE_INSTRUCTIONS, model: resolveModel('writer') });

// ─── Schemas ──────────────────────────────────────────────────────────────────

const summarySchema       = z.object({ summary: z.string() });
const reportSectionsSchema = z.object({ reportSections: z.array(z.object({ heading: z.string(), body: z.string() })) });
type Dataset = z.infer<typeof datasetSchema>;

// ─── Shared LLM call helper ───────────────────────────────────────────────────

async function callWriter<T>(schema: z.ZodSchema<T>, label: string, system: string, user: string, maxTokens: number): Promise<T> {
  const { object } = await withTimeout(
    generateObject({ model: resolveModel('writer'), schema, system, messages: [{ role: 'user', content: user }], maxTokens, temperature: 0 }),
    label, envTimeout('WRITER_TIMEOUT_MS', 10000),
  );
  return object;
}

// ─── Runtime functions ────────────────────────────────────────────────────────

export const runInquiryWriter = ({ prompt, dataset }: { prompt: string; dataset: Dataset }) =>
  callWriter(
    summarySchema, 'writer.inquiry',
    'Return { "summary": string }. Respond in the same language as the prompt. Use only the provided records.',
    `Summarize in 2–4 sentences.\n\nQuestion: ${prompt}\nRecords (first 10): ${JSON.stringify(dataset.rows.slice(0, 10))}`,
    512,
  );

export const runReportWriter = ({ prompt, dataset }: { prompt: string; dataset: Dataset }) =>
  callWriter(
    reportSectionsSchema, 'writer.report',
    'Return { "reportSections": [{ "heading": string, "body": string }] }. Respond in the same language as the prompt.',
    `Write a structured analytical report.\n\nPrompt: ${prompt}\nDataset: ${JSON.stringify(dataset).slice(0, 8000)}`,
    1024,
  );
