import { generateObject } from 'ai';
import { z } from 'zod';
import { resolveModel, freshSignal } from './model';
import { readMarkdownSection, skillFile } from './skill-prompt';
import { log, logTrace } from '../common/logger/app.logger';
import { buildInquiryMessage, buildReportMessage } from '../prompts/writer.prompt';

const INQUIRY_INSTRUCTIONS = readMarkdownSection(skillFile('inquiry', 'SKILL.md'), 'Runtime Prompt');
const REPORT_INSTRUCTIONS  = readMarkdownSection(skillFile('report',  'SKILL.md'), 'Runtime Prompt');

const INQUIRY_MAX_TOKENS = Number(process.env['INQUIRY_MAX_TOKENS'] ?? 400);
const REPORT_MAX_TOKENS  = Number(process.env['REPORT_MAX_TOKENS']  ?? 1_200);
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
export interface WriterInput { prompt: string; rows: unknown[]; withChart?: boolean; apiKey?: string }

export async function runInquirySkill({ prompt, rows, apiKey }: WriterInput): Promise<InquirySummary> {
  const t0 = Date.now();
  log('writer:inquiry', `rows: ${rows.length} | maxRows: ${INQUIRY_MAX_ROWS} | maxTokens: ${INQUIRY_MAX_TOKENS}`);
  const { object } = await generateObject({
    model:       resolveModel('writer', apiKey),
    abortSignal: freshSignal('writer'),
    temperature: 0,
    maxRetries:  1,
    schema:      summarySchema,
    system:      INQUIRY_INSTRUCTIONS,
    maxTokens:   INQUIRY_MAX_TOKENS,
    messages:    [{ role: 'user', content: buildInquiryMessage(prompt, rows, INQUIRY_MAX_ROWS, WRITER_MAX_CHARS) }],
  });
  log('writer:inquiry', `done | ${Date.now() - t0}ms`);
  logTrace('writer:inquiry', `result`, object);
  return object;
}

export async function runReportSkill({ prompt, rows, withChart, apiKey }: WriterInput): Promise<ReportSections> {
  const start = Date.now();
  log('writer:report', `rows: ${rows.length} | maxTokens: ${REPORT_MAX_TOKENS} | withChart: ${withChart ?? false}`);
  const { object } = await generateObject({
    model:       resolveModel('writer', apiKey),
    abortSignal: freshSignal('writer'),
    temperature: 0,
    maxRetries:  1,
    schema:      reportSectionsSchema,
    system:      REPORT_INSTRUCTIONS,
    maxTokens:   REPORT_MAX_TOKENS,
    messages:    [{ role: 'user', content: buildReportMessage(prompt, rows, WRITER_MAX_CHARS, withChart) }],
  });
  log('writer:report', `done in ${Date.now() - start}ms | sections: ${object.reportSections.length}`);
  logTrace('writer:report', `result`, object);
  return object;
}
