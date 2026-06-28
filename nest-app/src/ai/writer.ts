import { generateObject } from 'ai';
import { z } from 'zod';
import { resolveModel, freshSignal } from './model';
import { readMarkdownSection, skillFile } from './skill-prompt';
import { log, logTrace } from '../common/logger/app.logger';
import { buildInquiryMessage, buildReportMessage } from '../prompts';
import type { TokenUsage } from './token';

const INQUIRY_INSTRUCTIONS = readMarkdownSection(skillFile('inquiry', 'SKILL.md'), 'Runtime Prompt');
const REPORT_INSTRUCTIONS  = readMarkdownSection(skillFile('report',  'SKILL.md'), 'Runtime Prompt');

const INQUIRY_MAX_TOKENS = Number(process.env['INQUIRY_MAX_TOKENS'] ?? 400);
const REPORT_MAX_TOKENS  = Number(process.env['REPORT_MAX_TOKENS']  ?? 1_500);
const DEFAULT_MAX_TOKENS = 800;
const INQUIRY_MAX_ROWS   = Number(process.env['INQUIRY_MAX_ROWS']   ?? 10);
const WRITER_MAX_CHARS   = Number(process.env['WRITER_MAX_CHARS']   ?? 8_000);

const summarySchema = z.object({
  summary: z.string(),
});

const reportSectionsSchema = z.object({
  reportSections: z.array(z.object({
    heading: z.string(),
    body:    z.string(),
  })).min(1).max(5),
});

export type InquirySummary = z.infer<typeof summarySchema>;
export type ReportSections = z.infer<typeof reportSectionsSchema>;

export interface WriterResult<T> { result: T; usage: TokenUsage; }

export interface WriterInput {
  prompt:        string;
  rows:          unknown[];
  withChart?:    boolean;
  apiKey?:       string;
  userModel?:    string;
  userProvider?: string;
  maxTokens?:    number;
}

export async function runInquirySkill({ prompt, rows, apiKey, userModel, userProvider, maxTokens }: WriterInput): Promise<WriterResult<InquirySummary>> {
  const limit = maxTokens ?? INQUIRY_MAX_TOKENS;
  const t0 = Date.now();
  log('writer:inquiry', `rows: ${rows.length} | maxRows: ${INQUIRY_MAX_ROWS} | maxTokens: ${limit}`);

  const { object, usage } = await generateObject({
    model:       resolveModel('writer', apiKey, userModel, userProvider),
    abortSignal: freshSignal('writer'),
    temperature: 0,
    maxRetries:  1,
    schema:      summarySchema,
    system:      INQUIRY_INSTRUCTIONS,
    maxTokens:   limit,
    messages: [{ role: 'user', content: buildInquiryMessage(prompt, rows, INQUIRY_MAX_ROWS, WRITER_MAX_CHARS) }],
  });

  log('writer:inquiry', `done | ${Date.now() - t0}ms | in:${usage.promptTokens} out:${usage.completionTokens}`);
  logTrace('writer:inquiry', `result`, object);
  return { result: object, usage: { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens } };
}

export async function runReportSkill({ prompt, rows, withChart, apiKey, userModel, userProvider, maxTokens }: WriterInput): Promise<WriterResult<ReportSections>> {
  const limit = maxTokens ?? REPORT_MAX_TOKENS;
  const start = Date.now();
  log('writer:report', `rows: ${rows.length} | maxTokens: ${limit} | withChart: ${withChart ?? false}`);

  const { object, usage } = await generateObject({
    model:       resolveModel('writer', apiKey, userModel, userProvider),
    abortSignal: freshSignal('writer'),
    temperature: 0,
    maxRetries:  1,
    schema:      reportSectionsSchema,
    system:      REPORT_INSTRUCTIONS,
    maxTokens:   limit,
    messages: [{ role: 'user', content: buildReportMessage(prompt, rows, WRITER_MAX_CHARS, withChart) }],
  });

  log('writer:report', `done in ${Date.now() - start}ms | sections: ${object.reportSections.length} | in:${usage.promptTokens} out:${usage.completionTokens}`);
  logTrace('writer:report', `result`, object);
  return { result: object, usage: { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens } };
}
